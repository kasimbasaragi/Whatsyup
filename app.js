import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  onAuthStateChanged, signOut, deleteUser
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, setDoc, getDoc, addDoc, updateDoc, collection, query, where,
  orderBy, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig, DEFAULT_COUNTRY_CODE } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------------ helpers */
const normPhone = (p) => {
  let d = (p || "").replace(/\D/g, "");
  if (d.length === 10) d = DEFAULT_COUNTRY_CODE + d;
  return d;
};
const chatIdFor = (a, b) => [a, b].sort().join("_");
const initials = (n) => (n || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const fmtTime = (d) => d ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
function dayLabel(d) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  const diff = Math.round((today - x) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
}

let me = null;            // { uid, name, phone, email }
let chats = [];
let currentChat = null;   // { id, peerUid, peerName, peerPhone }
let unsubChats = null, unsubMsgs = null;

/* --------------------------------------------------------------------- auth */
let signupMode = false;
function setMode(signup) {
  signupMode = signup;
  $("tabLogin").classList.toggle("active", !signup);
  $("tabSignup").classList.toggle("active", signup);
  $("fName").hidden = !signup; $("fPhone").hidden = !signup;
  $("fName").required = signup; $("fPhone").required = signup;
  $("authBtn").textContent = signup ? "Create account" : "Log in";
  $("fPass").autocomplete = signup ? "new-password" : "current-password";
  $("authErr").textContent = "";
}
$("tabLogin").onclick = () => setMode(false);
$("tabSignup").onclick = () => setMode(true);

$("authForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("authErr"); err.textContent = "";
  const email = $("fEmail").value.trim(), pass = $("fPass").value;
  $("authBtn").disabled = true;
  try {
    if (!signupMode) {
      await signInWithEmailAndPassword(auth, email, pass);
    } else {
      const name = $("fName").value.trim();
      const phone = normPhone($("fPhone").value);
      if (phone.length < 8) throw new Error("Enter a valid mobile number.");
      const cred = await createUserWithEmailAndPassword(auth, email, pass);
      const uid = cred.user.uid;
      // Make sure this mobile number isn't already used by someone else.
      const taken = await getDoc(doc(db, "phones", phone));
      if (taken.exists()) {
        await deleteUser(cred.user);
        throw new Error("That mobile number is already registered.");
      }
      await setDoc(doc(db, "phones", phone), { uid });
      await setDoc(doc(db, "users", uid), { name, phone, email, createdAt: serverTimestamp() });
    }
  } catch (ex) {
    err.textContent = friendlyError(ex);
  } finally {
    $("authBtn").disabled = false;
  }
});

function friendlyError(ex) {
  const c = ex.code || "";
  if (c.includes("email-already-in-use")) return "This email is already registered. Try logging in.";
  if (c.includes("invalid-credential") || c.includes("wrong-password") || c.includes("user-not-found")) return "Wrong email or password.";
  if (c.includes("weak-password")) return "Password must be at least 6 characters.";
  if (c.includes("invalid-email")) return "Please enter a valid email.";
  if (c.includes("api-key") || c.includes("invalid-api")) return "Firebase is not configured yet. Edit firebase-config.js.";
  return ex.message || "Something went wrong.";
}

$("btnLogout").onclick = () => signOut(auth);

onAuthStateChanged(auth, async (user) => {
  teardown();
  if (!user) {
    me = null;
    $("app").hidden = true; $("auth").hidden = false;
    return;
  }
  // Profile may take a moment right after sign-up; retry briefly.
  let snap = null;
  for (let i = 0; i < 10; i++) {
    snap = await getDoc(doc(db, "users", user.uid));
    if (snap.exists()) break;
    await new Promise((r) => setTimeout(r, 400));
  }
  if (!snap || !snap.exists()) { signOut(auth); return; }
  me = { uid: user.uid, ...snap.data() };
  $("auth").hidden = true; $("app").hidden = false;
  $("meName").textContent = me.name;
  $("mePhone").textContent = "+" + me.phone;
  $("meAvatar").textContent = initials(me.name);
  startChatsListener();
});

function teardown() {
  unsubChats && unsubChats(); unsubMsgs && unsubMsgs();
  unsubChats = unsubMsgs = null;
  chats = []; currentChat = null;
  $("chatList").innerHTML = ""; $("messages").innerHTML = "";
  $("chat").hidden = true; $("empty").hidden = false;
  $("app").classList.remove("chat-open");
}

/* -------------------------------------------------------------- chat list */
function startChatsListener() {
  const q = query(collection(db, "chats"), where("members", "array-contains", me.uid));
  unsubChats = onSnapshot(q, (snap) => {
    chats = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    chats.sort((a, b) => (b.lastAt?.toMillis?.() ?? 0) - (a.lastAt?.toMillis?.() ?? 0));
    renderChatList();
  });
}
$("filter").addEventListener("input", renderChatList);

function peerOf(chat) {
  const uid = chat.members.find((m) => m !== me.uid);
  const info = chat.info?.[uid] || {};
  return { uid, name: info.name || "Unknown", phone: info.phone || "" };
}

function renderChatList() {
  const ul = $("chatList"); ul.innerHTML = "";
  const f = $("filter").value.trim().toLowerCase();
  const shown = chats.filter((c) => {
    const p = peerOf(c);
    return !f || p.name.toLowerCase().includes(f) || p.phone.includes(f);
  });
  $("noChats").hidden = chats.length > 0;
  shown.forEach((c) => {
    const p = peerOf(c);
    const li = document.createElement("li");
    li.className = "chat-item" + (currentChat?.id === c.id ? " active" : "");
    const av = document.createElement("div"); av.className = "avatar"; av.textContent = initials(p.name);
    const meta = document.createElement("div"); meta.className = "meta";
    const top = document.createElement("div"); top.className = "top";
    const nm = document.createElement("strong"); nm.textContent = p.name;
    const tm = document.createElement("time"); tm.textContent = fmtTime(c.lastAt?.toDate?.());
    top.append(nm, tm);
    const last = document.createElement("div"); last.className = "last"; last.textContent = c.lastMessage || "Say hi 👋";
    meta.append(top, last);
    li.append(av, meta);
    li.onclick = () => openChat(c.id, p);
    ul.append(li);
  });
}

/* --------------------------------------------------------------- new chat */
$("btnNew").onclick = () => { $("newPhone").value = ""; $("newErr").textContent = ""; $("newDlg").showModal(); };
$("newCancel").onclick = () => $("newDlg").close();
$("newForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("newErr"); err.textContent = "";
  const phone = normPhone($("newPhone").value);
  if (phone === me.phone) { err.textContent = "That's your own number."; return; }
  try {
    const p = await getDoc(doc(db, "phones", phone));
    if (!p.exists()) { err.textContent = "No Whatsyup user with that number."; return; }
    const peerUid = p.data().uid;
    const u = await getDoc(doc(db, "users", peerUid));
    const peer = u.data();
    const id = chatIdFor(me.uid, peerUid);
    const ref = doc(db, "chats", id);
    const existing = await getDoc(ref);
    if (!existing.exists()) {
      await setDoc(ref, {
        members: [me.uid, peerUid],
        info: {
          [me.uid]: { name: me.name, phone: me.phone },
          [peerUid]: { name: peer.name, phone: peer.phone }
        },
        lastMessage: "", lastAt: serverTimestamp()
      });
    }
    $("newDlg").close();
    openChat(id, { uid: peerUid, name: peer.name, phone: peer.phone });
  } catch (ex) {
    err.textContent = ex.message;
  }
});

/* ------------------------------------------------------------- open chat */
function openChat(id, peer) {
  currentChat = { id, peerUid: peer.uid, peerName: peer.name, peerPhone: peer.phone };
  $("empty").hidden = true; $("chat").hidden = false;
  $("app").classList.add("chat-open");
  $("peerName").textContent = peer.name;
  $("peerPhone").textContent = "+" + peer.phone;
  $("peerAvatar").textContent = initials(peer.name);
  renderChatList();
  unsubMsgs && unsubMsgs();
  const q = query(collection(db, "chats", id, "messages"), orderBy("at", "asc"));
  unsubMsgs = onSnapshot(q, (snap) => {
    const box = $("messages"); box.innerHTML = "";
    let lastDay = "";
    snap.docs.forEach((d) => {
      const m = d.data();
      const when = m.at?.toDate?.() ?? new Date();
      const label = dayLabel(when);
      if (label !== lastDay) {
        const sep = document.createElement("div"); sep.className = "day"; sep.textContent = label;
        box.append(sep); lastDay = label;
      }
      const mine = m.from === me.uid;
      const div = document.createElement("div");
      div.className = "msg" + (mine ? " me" : "");
      const span = document.createElement("span"); span.textContent = m.text;
      const t = document.createElement("span"); t.className = "t"; t.textContent = fmtTime(when);
      if (mine) {
        const tick = document.createElement("span"); tick.className = "tick";
        tick.textContent = d.metadata.hasPendingWrites ? "🕓" : "✓";
        t.append(tick);
      }
      div.append(span, t); box.append(div);
    });
    box.scrollTop = box.scrollHeight;
  });
}
$("btnBack").onclick = () => {
  $("app").classList.remove("chat-open");
  unsubMsgs && unsubMsgs(); unsubMsgs = null;
  currentChat = null; $("chat").hidden = true; $("empty").hidden = false; renderChatList();
};

$("sendForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("msgInput").value.trim();
  if (!text || !currentChat) return;
  $("msgInput").value = "";
  $("msgInput").focus();
  try {
    await addDoc(collection(db, "chats", currentChat.id, "messages"), { from: me.uid, text, at: serverTimestamp() });
    await updateDoc(doc(db, "chats", currentChat.id), { lastMessage: text, lastAt: serverTimestamp() });
  } catch (ex) {
    alert("Message could not be sent: " + ex.message);
  }
});
