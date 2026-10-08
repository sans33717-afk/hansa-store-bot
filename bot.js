require("dotenv").config();

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");

const P = require("pino");
const qrcode = require("qrcode-terminal");
const fs = require("fs");
const axios = require("axios");

// =====================================================
// CONFIG
// =====================================================

const ADMIN_NUMBER = "0764903603";
const ADMIN_JID = "94764903603@s.whatsapp.net";

const EZCASH_NUMBER = "0768431458";

const DB_FILE = "./wallet-data.json";
const AUTH_DIR = "./auth_info";

const FF_API_BASE = "http://siambhau69.eu.cc";
const FF_API_KEY = process.env.FFINFO_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";

const FF_REGIONS = [
  "SG",
  "BD",
  "IN",
  "ID",
  "BR",
  "TH",
  "VN",
  "MY",
  "PK",
  "ME",
  "EU",
  "NA",
  "SAC",
  "US",
  "RU"
];

// =====================================================
// DATABASE
// =====================================================

let db = {
  users: {},
  usedRN: [],
  orders: {},
  orderCounter: 0,

  tournaments: {},
  tournamentCounter: 0,
  tournamentRegistrationCounter: 0
};

if (fs.existsSync(DB_FILE)) {
  try {
    const old = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));

    db = {
      users: old.users || {},
      usedRN: old.usedRN || [],
      orders: old.orders || {},
      orderCounter: old.orderCounter || 0,

      tournaments: old.tournaments || {},
      tournamentCounter: old.tournamentCounter || 0,
      tournamentRegistrationCounter:
        old.tournamentRegistrationCounter || 0
    };
  } catch (e) {
    console.log("❌ Database load error:", e.message);
  }
}

// =====================================================
// EZ CASH ADMIN RN DATABASE
// =====================================================

if (!db.ezCashRNs || typeof db.ezCashRNs !== "object") {
  db.ezCashRNs = {};
}

function saveDB() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// =====================================================
// STATES
// =====================================================

const states = {};

function setState(jid, state, data = {}) {
  states[jid] = {
    ...data,
    state
  };
}

function getState(jid) {
  return states[jid] || { state: "NONE" };
}

function clearState(jid) {
  delete states[jid];
}

// =====================================================
// HELPERS
// =====================================================

function isAdmin(jid) {
  return jid === ADMIN_JID || jid === "53910932816017@lid";
}

function money(n) {
  return Number(n || 0).toLocaleString("en-LK");
}

function normalizeText(text) {
  return String(text || "").trim();
}

function generateOrderId() {
  db.orderCounter++;
  return "HN" + String(db.orderCounter).padStart(6, "0");
}

function generateTournamentId() {
  db.tournamentCounter++;
  return "HT" + String(db.tournamentCounter).padStart(6, "0");
}

function generateRegistrationId() {
  db.tournamentRegistrationCounter++;

  return (
    "HR" +
    String(db.tournamentRegistrationCounter).padStart(6, "0")
  );
}

function ensureUser(jid) {
  if (!db.users[jid] || typeof db.users[jid] !== "object") {
    db.users[jid] = {
      balance: 0,
      orders: []
    };
  }

  if (!Array.isArray(db.users[jid].orders)) {
    db.users[jid].orders = [];
  }

  if (typeof db.users[jid].balance !== "number") {
    db.users[jid].balance = Number(db.users[jid].balance || 0);
  }

  return db.users[jid];
}

function getBalance(jid) {
  return ensureUser(jid).balance || 0;
}

function addBalance(jid, amount) {
  const user = ensureUser(jid);

  user.balance = Number(user.balance || 0) + Number(amount);

  saveDB();

  return user.balance;
}

function deductBalance(jid, amount) {
  const user = ensureUser(jid);

  amount = Number(amount);

  if (user.balance < amount) {
    return false;
  }

  user.balance -= amount;

  saveDB();

  return true;
}

async function send(sock, jid, text) {
  try {
    await sock.sendMessage(jid, { text });
  } catch (e) {
    console.log("Send error:", e.message);
  }
}

// =====================================================
// MAIN MENU
// =====================================================

async function mainMenu(sock, jid) {
  setState(jid, "MAIN");

  await send(
    sock,
    jid,
    `🛒 HANSA STORE
━━━━━━━━━━━━━━━━━━

1️⃣ WALLET TOP UP
2️⃣ FREE FIRE TOP UP
3️⃣ CHECK ORDER
4️⃣ FREE FIRE TOURNAMENT

━━━━━━━━━━━━━━━━━━
Reply with 1, 2, 3 or 4

💰 Type balance to check wallet
🛑 Type cancel to cancel current flow`
  );
}

// =====================================================
// BALANCE
// =====================================================

async function showBalance(sock, jid) {
  await send(
    sock,
    jid,
    `💰 WALLET BALANCE
━━━━━━━━━━━━━━━━━━

💳 Balance: Rs.${money(getBalance(jid))}

━━━━━━━━━━━━━━━━━━
🛒 Type menu for Main Menu`
  );
}

// =====================================================
// CANCEL
// =====================================================

async function cancelFlow(sock, jid) {
  clearState(jid);

  await send(
    sock,
    jid,
    `🛑 CURRENT FLOW CANCELLED

Type menu to open Main Menu.`
  );
}

// =====================================================
// FREE FIRE PACKAGES
// =====================================================

const FF_PACKAGES = {
  "1": {
    name: "Weekly Lite",
    price: 180
  },

  "2": {
    name: "Weekly",
    price: 650
  },

  "3": {
    name: "Monthly",
    price: 3200
  },

  "4": {
    name: "25 Diamonds",
    price: 150
  },

  "5": {
    name: "100 Diamonds",
    price: 400
  },

  "6": {
    name: "310 Diamonds",
    price: 1100
  },

  "7": {
    name: "520 Diamonds",
    price: 1620
  },

  "8": {
    name: "1060 Diamonds",
    price: 3200
  },

  "9": {
    name: "2180 Diamonds",
    price: 6500
  },

  "10": {
    name: "LV 6+",
    price: 200
  },

  "11": {
    name: "LV 10+",
    price: 330
  },

  "12": {
    name: "LV 15+",
    price: 330
  },

  "13": {
    name: "LV 20+",
    price: 330
  },

  "14": {
    name: "LV 25+",
    price: 330
  },

  "15": {
    name: "LV 30+",
    price: 450
  }
};

async function showFFPackages(sock, jid) {
  setState(jid, "FF_PACKAGE");

  let text =
    `💎 FREE FIRE TOP UP
━━━━━━━━━━━━━━━━━━\n\n`;

  for (const [key, pkg] of Object.entries(FF_PACKAGES)) {
    text += `${key}️⃣ ${pkg.name} — Rs.${money(pkg.price)}\n`;
  }

  text +=
    `\n━━━━━━━━━━━━━━━━━━
Reply package number
🛑 cancel`;

  await send(sock, jid, text);
}

// =====================================================
// FREE FIRE PLAYER INFO
// =====================================================

async function getFFPlayer(uid, region) {
  if (!FF_API_KEY) {
    throw new Error("FFINFO_API_KEY missing in .env");
  }

  const url =
    `${FF_API_BASE}/freefireinfo/bhau` +
    `?uid=${encodeURIComponent(uid)}` +
    `&region=${encodeURIComponent(region)}` +
    `&key=${encodeURIComponent(FF_API_KEY)}`;

  const response = await axios.get(url, {
    timeout: 10000
  });

  return response.data;
}

function findField(obj, keys) {
  if (!obj || typeof obj !== "object") return null;

  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null && String(obj[key]).trim()) {
      return obj[key];
    }
  }

  for (const value of Object.values(obj)) {
    if (value && typeof value === "object") {
      const found = findField(value, keys);
      if (found !== null) return found;
    }
  }

  return null;
}

async function findFFPlayer(uid) {
  for (const region of FF_REGIONS) {
    try {
      const data = await getFFPlayer(uid, region);

      if (!data) continue;

      const possibleName = findField(data, [
        "name",
        "nickname",
        "player_name",
        "playerName"
      ]);

      if (!possibleName) continue;

      const possibleUid =
        findField(data, [
          "uid",
          "accountId",
          "account_id",
          "playerId",
          "player_id"
        ]) || uid;

      const possibleRegion =
        findField(data, [
          "region",
          "server",
          "country"
        ]) || region;

      const level =
        findField(data, [
          "level",
          "player_level",
          "playerLevel"
        ]) || null;

      console.log(
        `✅ FF PLAYER FOUND | UID: ${possibleUid} | NAME: ${possibleName} | REGION: ${possibleRegion}`
      );

      return {
        uid: String(possibleUid),
        name: String(possibleName),
        region: String(possibleRegion),
        level
      };

    } catch (e) {
      console.log(`⚠️ FF API ${region}: ${e.message}`);
    }
  }

  return null;
}

// =====================================================
// FREE FIRE TOPUP
// =====================================================

async function startFFTopup(sock, jid) {
  setState(jid, "FF_PACKAGE");

  await showFFPackages(sock, jid);
}

async function handleFFPackage(sock, jid, text) {
  const pkg = FF_PACKAGES[text];

  if (!pkg) {
    await send(
      sock,
      jid,
      "❌ Invalid package.\n\nPackage number එකක් එවන්න."
    );

    return;
  }

  setState(jid, "FF_UID", {
    packageId: text,
    package: pkg
  });

  await send(
    sock,
    jid,
    `💎 ${pkg.name}
💰 Price: Rs.${money(pkg.price)}

━━━━━━━━━━━━━━━━━━

🎮 Free Fire UID එක එවන්න.

Example:
123456789

🛑 cancel`
  );
}

async function handleFFUID(sock, jid, text) {
  if (!/^\d{5,15}$/.test(text)) {
    await send(
      sock,
      jid,
      "❌ Valid Free Fire UID එකක් එවන්න."
    );

    return;
  }

  await send(
    sock,
    jid,
    "🔎 Player account එක check කරනවා...\n\nPlease wait..."
  );

  const player = await findFFPlayer(text);

  if (!player) {
    await send(
      sock,
      jid,
      `❌ Player හමු වුණේ නැහැ.

UID:
${text}

වෙනත් UID එකක් try කරන්න.`
    );

    return;
  }

  const state = getState(jid);


  setState(jid, "FF_CONFIRM", {
    packageId: state.packageId,
    package: state.package,
    player
  });

  await send(
    sock,
    jid,
    `🎮 FREE FIRE TOP UP
━━━━━━━━━━━━━━━━━━

💎 Package:
${state.package.name}

💰 Price:
Rs.${money(state.package.price)}

👤 Player:
${player.name}

🆔 UID:
${player.uid}

🌍 Region:
${player.region}

━━━━━━━━━━━━━━━━━━

Confirm order?

1️⃣ YES
2️⃣ NO`
  );
}

async function handleFFConfirm(sock, jid, text) {
  const state = getState(jid);

  if (text === "2" || text === "no") {
    clearState(jid);

    await send(
      sock,
      jid,
      "❌ Order cancelled.\n\nType menu for Main Menu."
    );

    return;
  }

  if (text !== "1" && text !== "yes") {
    await send(sock, jid, "Reply 1 for YES or 2 for NO.");
    return;
  }

  const orderId = generateOrderId();

  db.orders[orderId] = {
    id: orderId,
    jid,
    type: "FREE_FIRE_TOPUP",
    package: state.package.name,
    price: state.package.price,
    uid: state.player.uid,
    playerName: state.player.name,
    region: state.player.region,
    status: "PENDING",
    createdAt: new Date().toISOString()
  };

  ensureUser(jid).orders.push(orderId);

  saveDB();

  clearState(jid);

  await send(
    sock,
    jid,
    `✅ ORDER CREATED
━━━━━━━━━━━━━━━━━━

🆔 Order ID:
${orderId}

💎 Package:
${state.package.name}

💰 Amount:
Rs.${money(state.package.price)}

👤 Player:
${state.player.name}

🆔 UID:
${state.player.uid}

🌍 Region:
${state.player.region}

━━━━━━━━━━━━━━━━━━

⏳ Status:
PENDING

Admin approval එකෙන් පස්සේ top up process එක සිදු වේ.

🛒 Type menu for Main Menu`
  );

  await send(
    sock,
    ADMIN_JID,
    `🔔 NEW FREE FIRE ORDER
━━━━━━━━━━━━━━━━━━

🆔 ${orderId}

👤 Player:
${state.player.name}

🆔 UID:
${state.player.uid}

🌍 Region:
${state.player.region}

💎 Package:
${state.package.name}

💰 Amount:
Rs.${money(state.package.price)}

📱 Customer:
${jid}

━━━━━━━━━━━━━━━━━━

Reply:

${orderId} YES

or

${orderId} NO`
  );
}

// =====================================================
// ADMIN ADD EZ CASH RN
// =====================================================

async function startAdminAddRN(sock, jid) {

  setState(jid, "ADMIN_ADD_RN");

  await send(
    sock,
    jid,
    `🔐 ADMIN - ADD EZ CASH RN
━━━━━━━━━━━━━━━━━━

RN / Reference Number එක එවන්න.

Example:
20260919033318

🛑 cancel`
  );
}


async function handleAdminAddRN(sock, jid, text) {

  const rn = text.trim();

  if (rn.length < 3) {

    await send(
      sock,
      jid,
      "❌ Valid RN එකක් එවන්න."
    );

    return;
  }

  if (!db.ezCashRNs || typeof db.ezCashRNs !== "object") {
    db.ezCashRNs = {};
  }

  if (db.ezCashRNs[rn]) {

    const old = db.ezCashRNs[rn];

    await send(
      sock,
      jid,
      `❌ මේ RN එක දැනටමත් database එකේ තියෙනවා.

🔢 RN:
${rn}

💰 Amount:
Rs.${money(old.amount)}

📌 Status:
${old.used ? "USED" : "AVAILABLE"}`
    );

    return;
  }

  setState(jid, "ADMIN_ADD_RN_AMOUNT", {
    rn
  });

  await send(
    sock,
    jid,
    `🔢 RN:
${rn}

දැන් මේ RN එකට අදාල
amount එක එවන්න.

Example:
500

හෝ:
Rs.500`
  );
}


async function handleAdminAddRNAmount(sock, jid, text) {

  const state = getState(jid);

  const rn = state.rn;

  if (!rn) {

    clearState(jid);

    await send(
      sock,
      jid,
      "❌ RN session එක නැතිවෙලා. නැවත `add rn` කරන්න."
    );

    return;
  }

  const cleanAmount = text
    .replace(/rs\.?/ig, "")
    .replace(/,/g, "")
    .trim();

  const amount = Number(cleanAmount);

  if (!Number.isFinite(amount) || amount <= 0) {

    await send(
      sock,
      jid,
      `❌ Valid amount එකක් එවන්න.

Example:
500`
    );

    return;
  }

  if (!db.ezCashRNs || typeof db.ezCashRNs !== "object") {
    db.ezCashRNs = {};
  }

  if (db.ezCashRNs[rn]) {

    clearState(jid);

    await send(
      sock,
      jid,
      "❌ මේ RN එක දැනටමත් database එකේ තියෙනවා."
    );

    return;
  }

  db.ezCashRNs[rn] = {

    rn,

    amount,

    used: false,

    addedBy: jid,

    addedAt: new Date().toISOString()
  };

  saveDB();

  clearState(jid);

  await send(
    sock,
    jid,
    `✅ EZ CASH RN ADDED
━━━━━━━━━━━━━━━━━━

🔢 RN:
${rn}

💰 Amount:
Rs.${money(amount)}

📌 Status:
AVAILABLE

━━━━━━━━━━━━━━━━━━

Customer මේ RN එක දුන්නම
Rs.${money(amount)} wallet එකට
automatically add වෙනවා.

⚠️ RN එක භාවිතා කළාම ආයෙත්
use කරන්න බැහැ.`
  );

  console.log(
    `🔐 ADMIN ADDED RN | RN:${rn} | Rs.${amount}`
  );
}


// =====================================================
// WALLET TOP UP
// =====================================================

async function startWalletTopup(sock, jid) {
  setState(jid, "WALLET_METHOD");

  await send(
    sock,
    jid,
    `💰 WALLET TOP UP
━━━━━━━━━━━━━━━━━━

Select payment method:

1️⃣ EZ CASH
2️⃣ BANK
3️⃣ BINANCE

Reply with:
1 / 2 / 3

🛑 cancel`
  );
}


// =====================================================
// WALLET METHOD
// =====================================================

async function handleWalletMethod(sock, jid, text) {

  const method = text.trim();

  // EZ CASH
  if (method === "1") {

    setState(jid, "WALLET_EZ_RN");

    await send(
      sock,
      jid,
      `📱 EZ CASH WALLET TOP UP
━━━━━━━━━━━━━━━━━━

EZ CASH NUMBER:

📱 ${EZCASH_NUMBER}

━━━━━━━━━━━━━━━━━━

1️⃣ ${EZCASH_NUMBER} number එකට
EZ Cash payment එක කරන්න.

2️⃣ Payment එකෙන් පස්සේ
ලැබෙන RN / Reference Number එක
මෙතන එවන්න.

Example:
20260919033318

━━━━━━━━━━━━━━━━━━

💡 Amount එක මෙතන type කරන්න ඕන නැහැ.

SMS එකෙන් ලැබුණු මුදල
automatically detect කරලා
wallet එකට add කරනවා.

🛑 cancel`
    );

    return;
  }


  // BANK
  if (method === "2") {

    setState(jid, "WALLET_BANK");

    await send(
      sock,
      jid,
      `🏦 BANK WALLET TOP UP
━━━━━━━━━━━━━━━━━━

Bank payment details:

Admin bank account එකට
payment කරලා transaction/reference
number එක එවන්න.

🛑 cancel`
    );

    return;
  }


  // BINANCE
  if (method === "3") {

    setState(jid, "WALLET_BINANCE");

    await send(
      sock,
      jid,
      `🪙 BINANCE WALLET TOP UP
━━━━━━━━━━━━━━━━━━

Binance payment details:

Payment එක කරලා
Transaction ID / TXID එක එවන්න.

🛑 cancel`
    );

    return;
  }


  await send(
    sock,
    jid,
    `❌ Invalid option.

1️⃣ EZ CASH
2️⃣ BANK
3️⃣ BINANCE`
  );
}


// =====================================================
// EZ CASH SMS CHECK
// =====================================================

async function getEZCashPaymentByRN(rn) {

  const { execFile } = require("child_process");

  return new Promise((resolve) => {

    execFile(
      "termux-sms-list",
      ["-l", "100"],
      {
        timeout: 10000,
        maxBuffer: 1024 * 1024
      },
      (error, stdout) => {

        if (error) {
          console.log(
            "❌ EZ CASH SMS ERROR:",
            error.message
          );

          return resolve(null);
        }

        try {

          const messages = JSON.parse(stdout);

          if (!Array.isArray(messages)) {
            return resolve(null);
          }

          for (const sms of messages) {

            const sender = String(
              sms.address ||
              sms.number ||
              ""
            ).trim();

            const body = String(
              sms.body || ""
            );


            // Only eZ Cash messages
            if (!/eZ\s*Cash/i.test(sender)) {
              continue;
            }


            // Find RN
            const rnMatch = body.match(
              /RN\s*:\s*([0-9]{6,30})/i
            );

            if (!rnMatch) {
              continue;
            }


            const smsRN =
              rnMatch[1].trim();


            // RN must match customer input
            if (
              smsRN !==
              String(rn).trim()
            ) {
              continue;
            }


            // Find received amount
            const amountMatch =
              body.match(
                /Labunu\s*mudala\s*:\s*Rs\.?\s*([0-9,]+(?:\.[0-9]{1,2})?)/i
              );


            if (!amountMatch) {

              console.log(
                "⚠️ RN found but Labunu mudala not found"
              );

              return resolve(null);
            }


            const amount =
              Number(
                amountMatch[1]
                  .replace(/,/g, "")
              );


            if (
              !Number.isFinite(amount) ||
              amount <= 0
            ) {
              return resolve(null);
            }


            console.log(
              `✅ EZ CASH PAYMENT FOUND`
            );

            console.log(
              `RN: ${smsRN}`
            );

            console.log(
              `AMOUNT: Rs.${amount}`
            );


            return resolve({
              rn: smsRN,
              amount,
              smsId: sms._id,
              received: sms.received,
              body
            });
          }


          resolve(null);

        } catch (e) {

          console.log(
            "❌ SMS JSON ERROR:",
            e.message
          );

          resolve(null);
        }
      }
    );
  });
}


// =====================================================
// EZ CASH RN
// =====================================================

async function handleWalletRN(sock, jid, text) {

  const rn = text.trim();

  if (rn.length < 3) {
    await send(
      sock,
      jid,
      "❌ Valid RN / Reference Number එකක් එවන්න."
    );

    return;
  }

  // Make sure RN database exists
  if (!db.ezCashRNs || typeof db.ezCashRNs !== "object") {
    db.ezCashRNs = {};
  }

  const payment = db.ezCashRNs[rn];

  // RN not added by admin
  if (!payment) {

    await send(
      sock,
      jid,
      `❌ RN එක හමු වුණේ නැහැ.

🔢 RN:
${rn}

Admin විසින් මේ RN එක add කරලා නැත්නම්
මේ RN එකෙන් wallet top up කරන්න බැහැ.

🛒 Type menu`
    );

    return;
  }

  // RN already used
  if (payment.used === true) {

    await send(
      sock,
      jid,
      `❌ මේ RN එක දැනටමත් භාවිතා කරලා තියෙනවා.

🔢 RN:
${rn}

එක RN එකක් භාවිතා කරන්න පුළුවන්
එක් වරක් පමණයි.`
    );

    return;
  }

  const amount = Number(payment.amount);

  if (!Number.isFinite(amount) || amount <= 0) {

    await send(
      sock,
      jid,
      "❌ මේ RN එකට valid amount එකක් save කරලා නැහැ. Adminව contact කරන්න."
    );

    return;
  }

  const orderId = generateOrderId();

  // Mark RN as used BEFORE crediting
  // This prevents the same RN from being reused.
  payment.used = true;
  payment.usedBy = jid;
  payment.usedAt = new Date().toISOString();

  // Create approved order
  db.orders[orderId] = {

    id: orderId,

    jid,

    type: "WALLET_TOPUP",

    method: "EZ_CASH",

    amount,

    rn,

    status: "APPROVED",

    autoApproved: true,

    createdAt: new Date().toISOString(),

    approvedAt: new Date().toISOString()
  };

  ensureUser(jid).orders.push(orderId);

  // Add money to wallet
  addBalance(jid, amount);

  // Save wallet-data.json
  saveDB();

  clearState(jid);

  await send(
    sock,
    jid,
    `✅ WALLET TOP UP SUCCESS
━━━━━━━━━━━━━━━━━━

🆔 Order:
${orderId}

📱 Method:
EZ CASH

🔢 RN:
${rn}

💰 Added:
Rs.${money(amount)}

💳 New Balance:
Rs.${money(getBalance(jid))}

━━━━━━━━━━━━━━━━━━

✅ Payment verified.
✅ Amount added to wallet.

⚠️ This RN can only be used once.

🛒 Type menu`
  );

  console.log(
    `💰 EZ CASH RN USED | ${orderId} | ${jid} | Rs.${amount} | RN:${rn}`
  );
}

// =====================================================
// ORDER CHECK
// =====================================================

async function checkOrders(sock, jid) {
  const user = ensureUser(jid);

  const orders = user.orders || [];

  if (!orders.length) {
    await send(
      sock,
      jid,
      `📦 MY ORDERS
━━━━━━━━━━━━━━━━━━

No orders found.

🛒 Type menu`
    );

    return;
  }

  let text =
    `📦 MY ORDERS
━━━━━━━━━━━━━━━━━━\n\n`;

  const lastOrders = orders.slice(-10).reverse();

  for (const id of lastOrders) {
    const order = db.orders[id];

    if (!order) continue;

    text +=
      `🆔 ${order.id}\n` +
      `📦 ${order.type}\n` +
      `💰 Rs.${money(order.amount || order.price || 0)}\n` +
      `📌 ${order.status}\n\n`;
  }

  text +=
    `━━━━━━━━━━━━━━━━━━
🛒 Type menu`;

  await send(sock, jid, text);
}

// =====================================================
// ADMIN ORDER APPROVAL
// =====================================================

async function handleAdminOrder(sock, jid, text) {
  const match = text.match(
    /^(HN\d{6})\s+(YES|NO)$/i
  );

  if (!match) return false;

  const orderId = match[1].toUpperCase();
  const action = match[2].toUpperCase();

  const order = db.orders[orderId];

  if (!order) {
    await send(sock, jid, "❌ Order not found.");
    return true;
  }

  if (order.status !== "PENDING") {
    await send(
      sock,
      jid,
      `⚠️ Order ${orderId} is already ${order.status}.`
    );

    return true;
  }

  if (action === "NO") {
    order.status = "REJECTED";

    saveDB();

    await send(
      sock,
      order.jid,
      `❌ ORDER REJECTED

🆔 ${order.id}

Your order was rejected by admin.

Type menu for Main Menu.`
    );

    await send(sock, jid, `❌ ${orderId} rejected.`);

    return true;
  }

  // WALLET TOPUP
  if (order.type === "WALLET_TOPUP") {
    if (db.usedRN.includes(order.rn)) {
      await send(
        sock,
        jid,
        "❌ RN already used."
      );

      return true;
    }

    if (!Array.isArray(db.usedRN)) {
      db.usedRN = [];
    }

    db.usedRN.push(order.rn);

    order.status = "APPROVED";

    addBalance(order.jid, order.amount);

    saveDB();

    await send(
      sock,
      order.jid,
      `✅ WALLET TOP UP APPROVED
━━━━━━━━━━━━━━━━━━

🆔 ${order.id}

💰 Added:
Rs.${money(order.amount)}

💳 New Balance:
Rs.${money(getBalance(order.jid))}

━━━━━━━━━━━━━━━━━━

🛒 Type menu`
    );

    await send(
      sock,
      jid,
      `✅ ${orderId} approved.

Wallet:
Rs.${money(order.amount)} added.`
    );

    return true;
  }

  // FREE FIRE ORDER
  order.status = "APPROVED";

  saveDB();

  await send(
    sock,
    order.jid,
    `✅ ORDER APPROVED
━━━━━━━━━━━━━━━━━━

🆔 ${order.id}

💎 ${order.package}

👤 ${order.playerName}

🆔 ${order.uid}

🌍 ${order.region}

━━━━━━━━━━━━━━━━━━

Admin approved the order.

Top-up processing started.

🛒 Type menu`
  );

  await send(
    sock,
    jid,
    `✅ ${orderId} approved.`
  );

  return true;
}

// =====================================================
// TOURNAMENT HELPERS
// =====================================================

function getTeamSize(tournament) {
  if (tournament.type === "BR") {
    if (tournament.teamType === "SOLO") return 1;
    if (tournament.teamType === "DUO") return 2;
    if (tournament.teamType === "SQUAD") return 4;
  }

  if (tournament.type === "CS") {
    return Number(tournament.teamSize);
  }

  return 1;
}

function tournamentOpen(t) {
  return t && t.status === "OPEN";
}

function registeredTeamCount(t) {
  return Array.isArray(t.registrations)
    ? t.registrations.length
    : 0;
}

function uidAlreadyRegistered(tournament, uid) {
  return tournament.registrations.some(reg =>
    reg.players.some(p => String(p.uid) === String(uid))
  );
}

function teamNameExists(tournament, teamName) {
  return tournament.registrations.some(
    reg =>
      String(reg.teamName).toLowerCase() ===
      String(teamName).toLowerCase()
  );
}

// =====================================================
// TOURNAMENT CREATE
// =====================================================

async function startTournamentCreate(sock, jid) {
  if (!isAdmin(jid)) return;

  setState(jid, "ADMIN_T_CREATE_TYPE");

  await send(
    sock,
    jid,
    `🏆 CREATE FREE FIRE TOURNAMENT
━━━━━━━━━━━━━━━━━━

🎮 Tournament Type එක තෝරන්න.

1️⃣ BR — Battle Royale
2️⃣ CS — Clash Squad

Reply 1 or 2
🛑 cancel`
  );
}

async function handleTournamentCreate(sock, jid, text) {
  const state = getState(jid);

  if (!isAdmin(jid)) return;

  if (state.state === "ADMIN_T_CREATE_TYPE") {
    if (text === "1") {
      setState(jid, "ADMIN_T_CREATE_BR");

      await send(
        sock,
        jid,
        `🎮 BR TEAM TYPE
━━━━━━━━━━━━━━━━━━

1️⃣ SOLO
2️⃣ DUO
3️⃣ SQUAD

Reply 1, 2 or 3`
      );

      return;
    }

    if (text === "2") {
      setState(jid, "ADMIN_T_CREATE_CS");

      await send(
        sock,
        jid,
        `⚔️ CS TEAM SIZE
━━━━━━━━━━━━━━━━━━

1️⃣ 4 PLAYERS
2️⃣ 6 PLAYERS

Reply 1 or 2`
      );

      return;
    }

    await send(sock, jid, "Reply 1 or 2.");
    return;
  }

  if (state.state === "ADMIN_T_CREATE_BR") {
    const map = {
      "1": "SOLO",
      "2": "DUO",
      "3": "SQUAD"
    };

    if (!map[text]) {
      await send(sock, jid, "Reply 1, 2 or 3.");
      return;
    }

    setState(jid, "ADMIN_T_NAME", {
      type: "BR",
      teamType: map[text],
      teamSize: null
    });

    await send(
      sock,
      jid,
      "🏆 Tournament Name එක එවන්න."
    );

    return;
  }

  if (state.state === "ADMIN_T_CREATE_CS") {
    const map = {
      "1": 4,
      "2": 6
    };

    if (!map[text]) {
      await send(sock, jid, "Reply 1 or 2.");
      return;
    }

    setState(jid, "ADMIN_T_NAME", {
      type: "CS",
      teamType: null,
      teamSize: map[text]
    });

    await send(
      sock,
      jid,
      "🏆 Tournament Name එක එවන්න."
    );

    return;
  }

  if (state.state === "ADMIN_T_NAME") {
    setState(jid, "ADMIN_T_ENTRY", {
      ...state,
      name: text
    });

    await send(
      sock,
      jid,
      "💰 Entry Fee එක එවන්න.\n\nExample: 100"
    );

    return;
  }

  if (state.state === "ADMIN_T_ENTRY") {
    const amount = Number(text);

    if (!Number.isFinite(amount) || amount < 0) {
      await send(sock, jid, "❌ Valid amount එකක් එවන්න.");
      return;
    }

    setState(jid, "ADMIN_T_MAX", {
      ...state,
      entryFee: amount
    });

    await send(
      sock,
      jid,
      "👥 Maximum Teams ගණන එවන්න.\n\nExample: 12"
    );

    return;
  }

  if (state.state === "ADMIN_T_MAX") {
    const maxTeams = Number(text);

    if (!Number.isInteger(maxTeams) || maxTeams <= 0) {
      await send(
        sock,
        jid,
        "❌ Valid team count එකක් එවන්න."
      );

      return;
    }

    setState(jid, "ADMIN_T_P1", {
      ...state,
      maxTeams
    });

    await send(
      sock,
      jid,
      "🥇 1st Prize එක එවන්න.\n\nExample: 1000"
    );

    return;
  }

  if (state.state === "ADMIN_T_P1") {
    const prize1 = Number(text);

    if (!Number.isFinite(prize1) || prize1 < 0) {
      await send(sock, jid, "❌ Valid prize එකක් එවන්න.");
      return;
    }

    setState(jid, "ADMIN_T_P2", {
      ...state,
      prize1
    });

    await send(sock, jid, "🥈 2nd Prize එක එවන්න.");
    return;
  }

  if (state.state === "ADMIN_T_P2") {
    const prize2 = Number(text);

    if (!Number.isFinite(prize2) || prize2 < 0) {
      await send(sock, jid, "❌ Valid prize එකක් එවන්න.");
      return;
    }

    setState(jid, "ADMIN_T_P3", {
      ...state,
      prize2
    });

    await send(sock, jid, "🥉 3rd Prize එක එවන්න.");
    return;
  }

  if (state.state === "ADMIN_T_P3") {
    const prize3 = Number(text);

    if (!Number.isFinite(prize3) || prize3 < 0) {
      await send(sock, jid, "❌ Valid prize එකක් එවන්න.");
      return;
    }

    setState(jid, "ADMIN_T_DATE", {
      ...state,
      prize3
    });

    await send(
      sock,
      jid,
      `📅 Tournament Date එක එවන්න.

Example:
2026-10-10`
    );

    return;
  }

  if (state.state === "ADMIN_T_DATE") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      await send(
        sock,
        jid,
        "❌ Date format:\n2026-10-10"
      );

      return;
    }

    setState(jid, "ADMIN_T_TIME", {
      ...state,
      date: text
    });

    await send(
      sock,
      jid,
      `⏰ Start Time එක එවන්න.

Example:
8:00 PM`
    );

    return;
  }

  if (state.state === "ADMIN_T_TIME") {
    const tournament = {
      id: null,
      name: state.name,
      type: state.type,
      teamType: state.teamType,
      teamSize: state.teamSize,

      entryFee: state.entryFee,
      maxTeams: state.maxTeams,

      prize1: state.prize1,
      prize2: state.prize2,
      prize3: state.prize3,

      date: state.date,
      time: text,

      status: "OPEN",

      roomId: null,
      roomPassword: null,
      liveLink: null,

      registrations: [],

      createdAt: new Date().toISOString()
    };

    tournament.id = generateTournamentId();

    setState(jid, "ADMIN_T_CONFIRM", {
      tournament
    });

    await send(
      sock,
      jid,
      `🏆 TOURNAMENT PREVIEW
━━━━━━━━━━━━━━━━━━

🆔 ${tournament.id}

🏆 ${tournament.name}

🎮 ${tournament.type} — ${
        tournament.teamType || `${tournament.teamSize} PLAYERS`
      }

💰 Entry: Rs.${money(tournament.entryFee)}

👥 Maximum Teams: ${tournament.maxTeams}

🥇 1st: Rs.${money(tournament.prize1)}
🥈 2nd: Rs.${money(tournament.prize2)}
🥉 3rd: Rs.${money(tournament.prize3)}

📅 ${tournament.date}
⏰ ${tournament.time}

━━━━━━━━━━━━━━━━━━

Create Tournament?

1️⃣ YES
2️⃣ NO`
    );

    return;
  }

  if (state.state === "ADMIN_T_CONFIRM") {
    if (text === "1" || text === "yes") {
      const tournament = state.tournament;

      db.tournaments[tournament.id] = tournament;

      saveDB();

      clearState(jid);

      await send(
        sock,
        jid,
        `✅ TOURNAMENT CREATED
━━━━━━━━━━━━━━━━━━

🆔 ${tournament.id}
🏆 ${tournament.name}

🎮 ${tournament.type}
📌 Status: OPEN

Customers can now register.

🛒 Type menu`
      );

      return;
    }

    if (text === "2" || text === "no") {
      clearState(jid);

      await send(
        sock,
        jid,
        "❌ Tournament creation cancelled."
      );

      return;
    }

    await send(sock, jid, "Reply 1 or 2.");
  }
}

// =====================================================
// CUSTOMER TOURNAMENT MENU
// =====================================================

async function startCustomerTournament(sock, jid) {
  setState(jid, "CUSTOMER_T_TYPE");

  await send(
    sock,
    jid,
    `🏆 FREE FIRE TOURNAMENT
━━━━━━━━━━━━━━━━━━

🎮 Game Mode එක තෝරන්න.

1️⃣ BR — Battle Royale
2️⃣ CS — Clash Squad

Reply 1 or 2
🛑 cancel`
  );
}

async function listTournaments(sock, jid, type) {
  const tournaments = Object.values(db.tournaments)
    .filter(
      t =>
        t.status === "OPEN" &&
        t.type === type
    );

  if (!tournaments.length) {
    await send(
      sock,
      jid,
      `❌ ${type} tournaments නැහැ.

🛒 Type menu`
    );

    clearState(jid);

    return;
  }

  let text =
    `🏆 ${type} TOURNAMENTS
━━━━━━━━━━━━━━━━━━\n\n`;

  for (const t of tournaments) {
    text +=
      `🆔 ${t.id}\n` +
      `🏆 ${t.name}\n` +
      `🎮 ${
        t.teamType ||
        `${t.teamSize} PLAYERS`
      }\n` +
      `💰 Entry: Rs.${money(t.entryFee)}\n` +
      `👥 Teams: ${registeredTeamCount(t)}/${t.maxTeams}\n` +
      `📅 ${t.date}\n` +
      `⏰ ${t.time}\n\n`;
  }

  text +=
    `━━━━━━━━━━━━━━━━━━

Tournament ID එක එවන්න.

Example:
HT000001

🛑 cancel`;

  setState(jid, "CUSTOMER_T_SELECT", {
    type
  });

  await send(sock, jid, text);
}

// =====================================================
// CUSTOMER TOURNAMENT REGISTRATION
// =====================================================

async function startTournamentRegistration(
  sock,
  jid,
  tournament
) {
  const size = getTeamSize(tournament);

  setState(jid, "CUSTOMER_TEAM_NAME", {
    tournamentId: tournament.id,
    tournament,
    playerCount: size,
    players: []
  });

  await send(
    sock,
    jid,
    `🏆 ${tournament.name}
━━━━━━━━━━━━━━━━━━

🆔 ${tournament.id}

🎮 ${
      tournament.type === "BR"
        ? `BR — ${tournament.teamType}`
        : `CS — ${tournament.teamSize} PLAYERS`
    }

💰 Entry:
Rs.${money(tournament.entryFee)}

👥 Required Players:
${size}

━━━━━━━━━━━━━━━━━━

Team Name එක එවන්න.

🛑 cancel`
  );
}

async function handleTournamentCustomer(
  sock,
  jid,
  text
) {
  const state = getState(jid);

  if (state.state === "CUSTOMER_T_TYPE") {
    if (text === "1") {
      await listTournaments(sock, jid, "BR");
      return;
    }

    if (text === "2") {
      await listTournaments(sock, jid, "CS");
      return;
    }

    await send(sock, jid, "Reply 1 or 2.");
    return;
  }

  if (state.state === "CUSTOMER_T_SELECT") {
    const tournament = db.tournaments[text.toUpperCase()];

    if (!tournament) {
      await send(
        sock,
        jid,
        "❌ Tournament ID not found."
      );

      return;
    }

    if (
      tournament.type !== state.type ||
      tournament.status !== "OPEN"
    ) {
      await send(
        sock,
        jid,
        "❌ Tournament registration unavailable."
      );

      return;
    }

    if (
      registeredTeamCount(tournament) >=
      tournament.maxTeams
    ) {
      await send(
        sock,
        jid,
        "❌ Tournament is full."
      );

      return;
    }

    await startTournamentRegistration(
      sock,
      jid,
      tournament
    );

    return;
  }

  if (state.state === "CUSTOMER_TEAM_NAME") {
    if (!text) {
      await send(sock, jid, "❌ Team name required.");
      return;
    }

    if (teamNameExists(state.tournament, text)) {
      await send(
        sock,
        jid,
        "❌ මේ Team Name එක දැනටමත් registered."
      );

      return;
    }

    setState(jid, "CUSTOMER_UID", {
      ...state,
      teamName: text,
      currentPlayer: 1
    });

    await send(
      sock,
      jid,
      `👤 PLAYER 1

Free Fire UID එක එවන්න.

🛑 cancel`
    );

    return;
  }

  if (state.state === "CUSTOMER_UID") {
    if (!/^\d{5,15}$/.test(text)) {
      await send(
        sock,
        jid,
        "❌ Valid Free Fire UID එකක් එවන්න."
      );

      return;
    }

    if (
      state.players.some(
        p => String(p.uid) === String(text)
      )
    ) {
      await send(
        sock,
        jid,
        "❌ මේ UID එක team එකේ දැනටමත් තියෙනවා."
      );

      return;
    }

    if (
      uidAlreadyRegistered(
        state.tournament,
        text
      )
    ) {
      await send(
        sock,
        jid,
        "❌ මේ UID එක මේ tournament එකේ වෙනත් team එකක registered."
      );

      return;
    }

    await send(
      sock,
      jid,
      `🔎 UID ${text} check කරනවා...

Please wait...`
    );

    const player = await findFFPlayer(text);

    if (!player) {
      await send(
        sock,
        jid,
        `❌ Player හමු වුණේ නැහැ.

UID:
${text}

වෙනත් UID එකක් එවන්න.`
      );

      return;
    }

    const newPlayers = [
      ...state.players,
      player
    ];

    if (
      newPlayers.length >=
      state.playerCount
    ) {
      setState(jid, "CUSTOMER_REG_CONFIRM", {
        ...state,
        players: newPlayers
      });

      let preview =
        `🏆 REGISTER PREVIEW
━━━━━━━━━━━━━━━━━━

🆔 Tournament:
${state.tournament.id}

🏆 ${state.tournament.name}

🎮 ${
          state.tournament.type === "BR"
            ? `BR — ${state.tournament.teamType}`
            : `CS — ${state.tournament.teamSize} PLAYERS`
        }

👥 Team:
${state.teamName}

━━━━━━━━━━━━━━━━━━\n\n`;

      newPlayers.forEach((p, index) => {
        preview +=
          `👤 PLAYER ${index + 1}\n` +
          `🆔 UID: ${p.uid}\n` +
          `🏷️ Name: ${p.name}\n` +
          `🌍 Region: ${p.region}\n\n`;
      });

      preview +=
        `━━━━━━━━━━━━━━━━━━
💰 Entry Fee:
Rs.${money(state.tournament.entryFee)}

💳 Wallet Balance:
Rs.${money(getBalance(jid))}

━━━━━━━━━━━━━━━━━━

Register this Team?

1️⃣ YES
2️⃣ NO`;

      await send(sock, jid, preview);

      return;
    }

    setState(jid, "CUSTOMER_UID", {
      ...state,
      players: newPlayers,
      currentPlayer: state.currentPlayer + 1
    });

    await send(
      sock,
      jid,
      `✅ PLAYER ${state.currentPlayer} VERIFIED

👤 Name:
${player.name}

🆔 UID:
${player.uid}

🌍 Region:
${player.region}

━━━━━━━━━━━━━━━━━━

👤 PLAYER ${state.currentPlayer + 1}

Next Free Fire UID එක එවන්න.`
    );

    return;
  }

  if (state.state === "CUSTOMER_REG_CONFIRM") {
    if (text === "2" || text === "no") {
      clearState(jid);

      await send(
        sock,
        jid,
        "❌ Tournament registration cancelled.\n\nType menu."
      );

      return;
    }

    if (text !== "1" && text !== "yes") {
      await send(sock, jid, "Reply 1 or 2.");
      return;
    }

    const tournament =
      db.tournaments[state.tournament.id];

    if (!tournament) {
      clearState(jid);

      await send(
        sock,
        jid,
        "❌ Tournament no longer exists."
      );

      return;
    }

    if (tournament.status !== "OPEN") {
      clearState(jid);

      await send(
        sock,
        jid,
        "❌ Tournament registration is closed."
      );

      return;
    }

    if (
      registeredTeamCount(tournament) >=
      tournament.maxTeams
    ) {
      clearState(jid);

      await send(
        sock,
        jid,
        "❌ Tournament is full."
      );

      return;
    }

    if (
      teamNameExists(
        tournament,
        state.teamName
      )
    ) {
      clearState(jid);

      await send(
        sock,
        jid,
        "❌ Team Name already registered."
      );

      return;
    }

    for (const player of state.players) {
      if (
        uidAlreadyRegistered(
          tournament,
          player.uid
        )
      ) {
        clearState(jid);

        await send(
          sock,
          jid,
          `❌ UID ${player.uid} is already registered in this tournament.`
        );

        return;
      }
    }

    const fee = Number(tournament.entryFee);

    if (getBalance(jid) < fee) {
      await send(
        sock,
        jid,
        `❌ INSUFFICIENT WALLET BALANCE

💰 Entry Fee:
Rs.${money(fee)}

💳 Your Balance:
Rs.${money(getBalance(jid))}

💵 Need:
Rs.${money(fee - getBalance(jid))}

First wallet එක top up කරන්න.

Type menu`
      );

      return;
    }

    if (!deductBalance(jid, fee)) {
      await send(
        sock,
        jid,
        "❌ Wallet deduction failed."
      );

      return;
    }

    const registrationId =
      generateRegistrationId();

    const registration = {
      id: registrationId,
      jid,
      teamName: state.teamName,
      players: state.players,
      entryFee: fee,
      registeredAt: new Date().toISOString()
    };

    tournament.registrations.push(
      registration
    );

    saveDB();

    clearState(jid);

    let success =
      `🎉 REGISTRATION SUCCESSFUL
━━━━━━━━━━━━━━━━━━

🎫 Registration ID:
${registrationId}

🆔 Tournament:
${tournament.id}

🏆 ${tournament.name}

🎮 ${
        tournament.type === "BR"
          ? `BR — ${tournament.teamType}`
          : `CS — ${tournament.teamSize} PLAYERS`
      }

👥 Team:
${registration.teamName}

━━━━━━━━━━━━━━━━━━\n\n`;

    registration.players.forEach(p => {
      success +=
        `👤 ${p.name}\n` +
        `🆔 ${p.uid}\n\n`;
    });

    success +=
      `━━━━━━━━━━━━━━━━━━
💰 Entry Paid:
Rs.${money(fee)}

💳 Remaining Wallet:
Rs.${money(getBalance(jid))}

📅 ${tournament.date}
⏰ ${tournament.time}

🍀 GOOD LUCK! 🔥`;

    await send(sock, jid, success);

    await send(
      sock,
      ADMIN_JID,
      `🏆 NEW TOURNAMENT REGISTRATION
━━━━━━━━━━━━━━━━━━

🎫 ${registrationId}

🆔 ${tournament.id}
🏆 ${tournament.name}

🎮 ${
        tournament.type === "BR"
          ? `BR — ${tournament.teamType}`
          : `CS — ${tournament.teamSize} PLAYERS`
      }

👥 Team:
${registration.teamName}

━━━━━━━━━━━━━━━━━━\n\n` +
        registration.players
          .map(
            (p, i) =>
              `PLAYER ${i + 1}: ${p.name}\nUID: ${p.uid}\nRegion: ${p.region}`
          )
          .join("\n\n") +
        `\n\n━━━━━━━━━━━━━━━━━━
👥 Teams:
${registeredTeamCount(tournament)}/${tournament.maxTeams}`
    );

    return;
  }
}

// =====================================================
// TOURNAMENT CLOSE
// =====================================================

async function startTournamentClose(
  sock,
  jid,
  tournamentId
) {
  if (!isAdmin(jid)) return;

  const id = tournamentId.toUpperCase();

  const tournament = db.tournaments[id];

  if (!tournament) {
    await send(
      sock,
      jid,
      "❌ Tournament not found."
    );

    return;
  }

  setState(jid, "ADMIN_T_CLOSE_CONFIRM", {
    tournamentId: id
  });

  await send(
    sock,
    jid,
    `🔒 CLOSE TOURNAMENT
━━━━━━━━━━━━━━━━━━

🆔 ${id}
🏆 ${tournament.name}

👥 Registered:
${registeredTeamCount(tournament)}/${tournament.maxTeams}

⚠️ Tournament එක close කරන්නද?

1️⃣ YES
2️⃣ NO`
  );
}

async function handleTournamentClose(
  sock,
  jid,
  text
) {
  const state = getState(jid);

  if (
    state.state !==
    "ADMIN_T_CLOSE_CONFIRM"
  ) {
    return;
  }

  const tournament =
    db.tournaments[state.tournamentId];

  if (!tournament) {
    clearState(jid);

    await send(sock, jid, "❌ Tournament not found.");
    return;
  }

  if (text === "1" || text === "yes") {
    tournament.status = "CLOSED";

    saveDB();

    clearState(jid);

    await send(
      sock,
      jid,
      `🔒 TOURNAMENT CLOSED

🆔 ${tournament.id}
🏆 ${tournament.name}

New registrations are disabled.`
    );

    return;
  }

  if (text === "2" || text === "no") {
    clearState(jid);

    await send(
      sock,
      jid,
      "❌ Close cancelled."
    );

    return;
  }

  await send(sock, jid, "Reply 1 or 2.");
}

// =====================================================
// TOURNAMENT START
// =====================================================

async function startTournamentStart(
  sock,
  jid,
  tournamentId
) {
  if (!isAdmin(jid)) return;

  const id = tournamentId.toUpperCase();

  const tournament = db.tournaments[id];

  if (!tournament) {
    await send(sock, jid, "❌ Tournament not found.");
    return;
  }

  if (tournament.status !== "OPEN") {
    await send(
      sock,
      jid,
      `❌ Tournament status is ${tournament.status}.`
    );

    return;
  }

  setState(jid, "ADMIN_T_ROOM", {
    tournamentId: id
  });

  await send(
    sock,
    jid,
    `🏆 TOURNAMENT START
━━━━━━━━━━━━━━━━━━

🆔 ${id}
🏆 ${tournament.name}

🏠 Room ID එක එවන්න.`
  );
}

async function handleTournamentStart(
  sock,
  jid,
  text
) {
  const state = getState(jid);

  if (state.state === "ADMIN_T_ROOM") {
    setState(jid, "ADMIN_T_PASSWORD", {
      tournamentId: state.tournamentId,
      roomId: text
    });

    await send(
      sock,
      jid,
      "🔐 Room Password එක එවන්න."
    );

    return;
  }

  if (state.state === "ADMIN_T_PASSWORD") {
    setState(jid, "ADMIN_T_LIVE", {
      tournamentId: state.tournamentId,
      roomId: state.roomId,
      roomPassword: text
    });

    await send(
      sock,
      jid,
      `🔴 LIVE LINK එක එවන්න.

Example:
https://youtube.com/live/xxxxxxxx`
    );

    return;
  }

  if (state.state === "ADMIN_T_LIVE") {
    const tournament =
      db.tournaments[state.tournamentId];

    if (!tournament) {
      clearState(jid);

      await send(sock, jid, "❌ Tournament not found.");
      return;
    }

    setState(jid, "ADMIN_T_START_CONFIRM", {
      tournamentId: tournament.id,
      roomId: state.roomId,
      roomPassword: state.roomPassword,
      liveLink: text
    });

    await send(
      sock,
      jid,
      `🏆 TOURNAMENT START PREVIEW
━━━━━━━━━━━━━━━━━━

🆔 ${tournament.id}
🏆 ${tournament.name}

🎮 ${
        tournament.type === "BR"
          ? `BR — ${tournament.teamType}`
          : `CS — ${tournament.teamSize} PLAYERS`
      }

🏠 Room ID:
${state.roomId}

🔐 Password:
${state.roomPassword}

🔴 LIVE:
${text}

👥 Registered Teams:
${registeredTeamCount(tournament)}

━━━━━━━━━━━━━━━━━━

Start Tournament?

1️⃣ YES
2️⃣ NO`
    );

    return;
  }

  if (
    state.state ===
    "ADMIN_T_START_CONFIRM"
  ) {
    const tournament =
      db.tournaments[state.tournamentId];

    if (!tournament) {
      clearState(jid);
      await send(sock, jid, "❌ Tournament not found.");
      return;
    }

    if (text === "2" || text === "no") {
      clearState(jid);

      await send(
        sock,
        jid,
        "❌ Tournament start cancelled."
      );

      return;
    }

    if (text !== "1" && text !== "yes") {
      await send(sock, jid, "Reply 1 or 2.");
      return;
    }

    tournament.roomId = state.roomId;
    tournament.roomPassword =
      state.roomPassword;
    tournament.liveLink = state.liveLink;
    tournament.status = "STARTED";

    saveDB();

    let success = 0;
    let failed = 0;

    for (const registration of tournament.registrations) {
      try {
        await send(
          sock,
          registration.jid,
          `🔥 TOURNAMENT STARTING NOW!
━━━━━━━━━━━━━━━━━━

🏆 ${tournament.name}
🆔 ${tournament.id}

🎮 ${
            tournament.type === "BR"
              ? `BR — ${tournament.teamType}`
              : `CS — ${tournament.teamSize} PLAYERS`
          }

👥 Team:
${registration.teamName}

🏠 ROOM ID
${tournament.roomId}

🔐 PASSWORD
${tournament.roomPassword}

🔴 LIVE LINK
${tournament.liveLink}

━━━━━━━━━━━━━━━━━━

⚠️ දැන්ම Room එකට join වෙන්න!

📺 Live එක බලන්න:
${tournament.liveLink}

🍀 GOOD LUCK! 🔥`
        );

        success++;
      } catch (e) {
        failed++;
      }
    }

    clearState(jid);

    await send(
      sock,
      jid,
      `✅ TOURNAMENT STARTED
━━━━━━━━━━━━━━━━━━

🆔 ${tournament.id}
🏆 ${tournament.name}

👥 Teams:
${registeredTeamCount(tournament)}

📲 Notifications sent:
${success}

❌ Failed:
${failed}`
    );

    return;
  }
}

// =====================================================
// ADMIN COMMANDS
// =====================================================

async function handleAdminCommand(
  sock,
  jid,
  text
) {
  if (!isAdmin(jid)) return false;

  const lower = text.toLowerCase();

  const ffAIHandled = await handleFFAI(sock, jid, text);

  if (ffAIHandled) return;


  if (lower === "add tournament") {
    await startTournamentCreate(sock, jid);
    return true;
  }

  let match = text.match(
    /^(HT\d{6})\s+close$/i
  );

  if (match) {
    await startTournamentClose(
      sock,
      jid,
      match[1]
    );

    return true;
  }

  match = text.match(
    /^start\s+(HT\d{6})$/i
  );

  if (match) {
    await startTournamentStart(
      sock,
      jid,
      match[1]
    );

    return true;
  }

  return false;
}


// =====================================================
// HANSA STORE FF AI
// =====================================================

function buildFFAIContext() {
  const packageText = Object.entries(FF_PACKAGES)
    .map(([id, p]) => `${id}. ${p.name} - Rs.${p.price}`)
    .join("\n");

  let tournamentText = "No tournaments available.";

  if (db.tournaments && Object.keys(db.tournaments).length) {
    tournamentText = Object.values(db.tournaments)
      .map(t => {
        const registered = typeof registeredTeamCount === "function"
          ? registeredTeamCount(t)
          : 0;

        return [
          `Tournament ID: ${t.id}`,
          `Name: ${t.name || t.title || "Free Fire Tournament"}`,
          `Type: ${t.type || t.mode || "N/A"}`,
          `Entry Fee: Rs.${t.entryFee || t.fee || 0}`,
          `Date: ${t.date || "N/A"}`,
          `Time: ${t.time || "N/A"}`,
          `Prize: ${t.prize || t.prizes || "N/A"}`,
          `Teams: ${registered}/${t.maxTeams || "N/A"}`,
          `Status: ${t.status || "N/A"}`
        ].join(" | ");
      })
      .join("\n");
  }

  return `
You are HANSA TOP UP STORE WhatsApp AI assistant.

IMPORTANT:
- Only answer questions about HANSA TOP UP STORE, Free Fire top-ups, tournaments, wallet and payments.
- Use ONLY the store information given below.
- NEVER invent prices.
- ALWAYS include the exact Rs. price when the customer asks about a package.
- If the customer asks "price", "මිල", "ගාන", "කීයද", give the matching package price.
- If they ask for all prices, list all available packages and prices.
- Currency is Sri Lankan Rupees (Rs.).
- Keep answers short and WhatsApp-friendly.
- Reply in Sinhala/Singlish when the customer uses Sinhala/Singlish.

FREE FIRE TOP-UP PRICES:
${packageText}

TOURNAMENT INFORMATION:
${tournamentText}

WALLET PAYMENT:
EZ Cash Number: ${EZCASH_NUMBER}
`;
}

const FF_AI_PRICES = `
FREE FIRE STORE PRICES — USE THESE EXACT PRICES:
Weekly Lite = Rs.180
Weekly = Rs.650
Monthly = Rs.3200
25 Diamonds = Rs.150
100 Diamonds = Rs.400
310 Diamonds = Rs.1100
520 Diamonds = Rs.1620
1060 Diamonds = Rs.3200
2180 Diamonds = Rs.6500
Level Up Pass LV6+ = Rs.200
Level Up Pass LV10+ = Rs.330
Level Up Pass LV15+ = Rs.330
Level Up Pass LV20+ = Rs.330
Level Up Pass LV25+ = Rs.330
Level Up Pass LV30+ = Rs.450
`;

async function askFFAI(question) {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY missing");
  }

  const storePrices = `
HANSA STORE FREE FIRE PRICES:

Weekly Lite - Rs.180
Weekly - Rs.650
Monthly - Rs.3200

25 Diamonds - Rs.150
100 Diamonds - Rs.400
310 Diamonds - Rs.1100
520 Diamonds - Rs.1620
1060 Diamonds - Rs.3200
2180 Diamonds - Rs.6500

Level Up Pass LV6+ - Rs.200
Level Up Pass LV10+ - Rs.330
Level Up Pass LV15+ - Rs.330
Level Up Pass LV20+ - Rs.330
Level Up Pass LV25+ - Rs.330
Level Up Pass LV30+ - Rs.450
`;

  const context = buildFFAIContext();

  const prompt = `
You are HANSA TOP UP STORE customer support AI.

Answer ONLY questions about HANSA STORE,
Free Fire top ups, prices, diamonds, tournaments,
entry fees, dates, times, prizes, wallet and payments.

IMPORTANT:
The following are the EXACT current Free Fire prices.
When customer asks for a price, use these prices exactly.

${storePrices}

Store information:
${JSON.stringify(context, null, 2)}

Customer question:
${question}

Rules:
- NEVER invent or change a price.
- If customer asks "මිල", "ගාන", "price", "කීයද", give the exact Rs. price.
- If customer asks for all prices, list all packages with prices.
- Never invent tournament information.
- If tournament information is unavailable, say it is not available.
- Reply in simple Sinhala/Singlish.
- Keep the answer short and WhatsApp-friendly.
`;

  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    encodeURIComponent(GEMINI_MODEL) +
    ":generateContent";

  let r;
  let lastError;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      r = await axios.post(
        url,
        {
          contents: [
            {
              parts: [
                {
                  text: prompt
                }
              ]
            }
          ],
          generationConfig: {
            maxOutputTokens: 400
          }
        },
        {
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": GEMINI_API_KEY
          },
          timeout: 60000
        }
      );

      break;

    } catch (e) {
      lastError = e;

      const status = e.response?.status;

      if (![408, 429, 500, 502, 503, 504].includes(status)) {
        throw e;
      }

      console.log(
        `⚠️ Gemini temporary error ${status} - retry ${attempt}/3`
      );

      if (attempt < 3) {
        await new Promise(resolve =>
          setTimeout(resolve, attempt * 3000)
        );
      }
    }
  }

  if (!r) {
    throw lastError || new Error("Gemini unavailable");
  }

  const answer =
    r.data?.candidates?.[0]?.content?.parts
      ?.map(x => x.text || "")
      .join("")
      .trim();

  if (!answer) {
    throw new Error("Empty Gemini response");
  }

  return answer;
}

async function handleFFAI(sock, jid, text) {
  const lower = text.toLowerCase().trim();

  if (lower === "ff ai") {
    setState(jid, "FF_AI");

    await send(
      sock,
      jid,
      `🤖 HANSA STORE FF AI ON

Store prices / tournaments ගැන අහන්න.

Example:
100 diamonds price කීයද?
Weekly price කීයද?
Tournament join price කීයද?

🛑 AI OFF:
ff ai off`
    );

    return true;
  }

  if (
    lower === "ff ai off" ||
    lower === "ffai off"
  ) {
    clearState(jid);

    await send(
      sock,
      jid,
      "🤖 FF AI OFF\n\n🛒 Type menu"
    );

    return true;
  }

  if (getState(jid).state !== "FF_AI") {
    return false;
  }

  try {
    const answer = await askFFAI(text);
    await send(sock, jid, answer);
  } catch (e) {
    console.log("❌ GEMINI ERROR:", e.response?.data || e.message);

    await send(
      sock,
      jid,
      "❌ AI error. GEMINI_API_KEY එක check කරන්න."
    );
  }

  return true;
}

// =====================================================
// MESSAGE HANDLER
// =====================================================

async function handleMessage(sock, msg) {
  if (!msg.message) return;

  if (msg.key.fromMe) return;

  const jid = msg.key.remoteJid;

  console.log("📱 RECEIVED JID:", jid);

  if (!jid || jid.endsWith("@g.us")) return;

  const messageType =
    Object.keys(msg.message)[0];

  let text = "";

  if (
    messageType === "conversation"
  ) {
    text = msg.message.conversation;
  } else if (
    messageType === "extendedTextMessage"
  ) {
    text =
      msg.message.extendedTextMessage.text;
  } else {
    return;
  }

  text = normalizeText(text);

  if (!text) return;

  const lower = text.toLowerCase();

  // =================================================
  // IMPORTANT:
  // MAIN MENU ONLY WHEN USER TYPES "menu"
  // =================================================

  if (lower === "menu") {
    await mainMenu(sock, jid);
    return;
  }

  // =================================================
  // CANCEL
  // =================================================

  if (lower === "cancel") {
    await cancelFlow(sock, jid);
    return;
  }

  // =================================================
  // BALANCE
  // =================================================

  if (lower === "balance") {
    await showBalance(sock, jid);
    return;
  }

  // =================================================
  // ADMIN COMMANDS
  // =================================================

  if (isAdmin(jid)) {
    const handled =
      await handleAdminCommand(
        sock,
        jid,
        text
      );

    if (handled) return;
  }

  // =================================================
  // ADMIN ORDER APPROVAL
  // =================================================

  if (isAdmin(jid)) {
    const handled =
      await handleAdminOrder(
        sock,
        jid,
        text
      );

    if (handled) return;
  }

  // =================================================

  const state = getState(jid);

  // =================================================
  // ADMIN EZ CASH RN
  // =================================================

  if (isAdmin(jid)) {

    if (
      lower === "add rn" ||
      lower === "ad rn"
    ) {

      await startAdminAddRN(sock, jid);
      return;
    }

    if (state.state === "ADMIN_ADD_RN") {

      await handleAdminAddRN(
        sock,
        jid,
        text
      );

      return;
    }

    if (state.state === "ADMIN_ADD_RN_AMOUNT") {

      await handleAdminAddRNAmount(
        sock,
        jid,
        text
      );

      return;
    }
  }

  // CURRENT STATE
  // =================================================



  // =================================================
  // ADMIN EZ CASH RN FLOW
  // =================================================

  if (isAdmin(jid)) {

    if (state.state === "ADMIN_ADD_RN") {
      await handleAdminAddRN(
        sock,
        jid,
        text
      );
      return;
    }

    if (state.state === "ADMIN_ADD_RN_AMOUNT") {
      await handleAdminAddRNAmount(
        sock,
        jid,
        text
      );
      return;
    }
  }

  // ADMIN TOURNAMENT CREATE
  if (
    isAdmin(jid) &&
    state.state.startsWith("ADMIN_T_CREATE_")
  ) {
    await handleTournamentCreate(
      sock,
      jid,
      text
    );

    return;
  }

  if (
    isAdmin(jid) &&
    state.state === "ADMIN_T_NAME"
  ) {
    await handleTournamentCreate(
      sock,
      jid,
      text
    );

    return;
  }

  if (
    isAdmin(jid) &&
    state.state === "ADMIN_T_ENTRY"
  ) {
    await handleTournamentCreate(
      sock,
      jid,
      text
    );

    return;
  }

  if (
    isAdmin(jid) &&
    state.state === "ADMIN_T_MAX"
  ) {
    await handleTournamentCreate(
      sock,
      jid,
      text
    );

    return;
  }

  if (
    isAdmin(jid) &&
    state.state === "ADMIN_T_P1"
  ) {
    await handleTournamentCreate(
      sock,
      jid,
      text
    );

    return;
  }

  if (
    isAdmin(jid) &&
    state.state === "ADMIN_T_P2"
  ) {
    await handleTournamentCreate(
      sock,
      jid,
      text
    );

    return;
  }

  if (
    isAdmin(jid) &&
    state.state === "ADMIN_T_P3"
  ) {
    await handleTournamentCreate(
      sock,
      jid,
      text
    );

    return;
  }

  if (
    isAdmin(jid) &&
    state.state === "ADMIN_T_DATE"
  ) {
    await handleTournamentCreate(
      sock,
      jid,
      text
    );

    return;
  }

  if (
    isAdmin(jid) &&
    state.state === "ADMIN_T_TIME"
  ) {
    await handleTournamentCreate(
      sock,
      jid,
      text
    );

    return;
  }

  if (
    isAdmin(jid) &&
    state.state === "ADMIN_T_CONFIRM"
  ) {
    await handleTournamentCreate(
      sock,
      jid,
      text
    );

    return;
  }

  // ADMIN CLOSE
  if (
    isAdmin(jid) &&
    state.state ===
      "ADMIN_T_CLOSE_CONFIRM"
  ) {
    await handleTournamentClose(
      sock,
      jid,
      text
    );

    return;
  }

  // ADMIN START
  if (
    isAdmin(jid) &&
    (
      state.state === "ADMIN_T_ROOM" ||
      state.state === "ADMIN_T_PASSWORD" ||
      state.state === "ADMIN_T_LIVE" ||
      state.state ===
        "ADMIN_T_START_CONFIRM"
    )
  ) {
    await handleTournamentStart(
      sock,
      jid,
      text
    );

    return;
  }

  // =================================================
  // WALLET
  // =================================================

  if (state.state === "WALLET_METHOD") {
    await handleWalletMethod(
      sock,
      jid,
      text
    );

    return;
  }

  if (state.state === "WALLET_EZ_RN") {
    await handleWalletRN(
      sock,
      jid,
      text
    );

    return;
  }

  if (state.state === "WALLET_BANK") {
    await handleWalletBank(
      sock,
      jid,
      text
    );

    return;
  }

  if (state.state === "WALLET_BINANCE") {
    await handleWalletBinance(
      sock,
      jid,
      text
    );

    return;
  }

  // =================================================
  // FREE FIRE TOPUP
  // =================================================

  if (state.state === "FF_PACKAGE") {
    await handleFFPackage(
      sock,
      jid,
      text
    );

    return;
  }

  if (state.state === "FF_UID") {
    await handleFFUID(
      sock,
      jid,
      text
    );

    return;
  }

  if (state.state === "FF_CONFIRM") {
    await handleFFConfirm(
      sock,
      jid,
      text
    );

    return;
  }

  // =================================================
  // TOURNAMENT CUSTOMER
  // =================================================

  if (
    state.state.startsWith("CUSTOMER_T_") ||
    state.state === "CUSTOMER_TEAM_NAME" ||
    state.state === "CUSTOMER_UID" ||
    state.state === "CUSTOMER_REG_CONFIRM"
  ) {
    await handleTournamentCustomer(
      sock,
      jid,
      text
    );

    return;
  }

  // =================================================
  // MAIN MENU OPTIONS
  // =================================================

  if (state.state === "MAIN") {
    if (text === "1") {
      await startWalletTopup(sock, jid);
      return;
    }

    if (text === "2") {
      await startFFTopup(sock, jid);
      return;
    }

    if (text === "3") {
      await checkOrders(sock, jid);
      return;
    }

    if (text === "4") {
      await startCustomerTournament(
        sock,
        jid
      );

      return;
    }

    // IMPORTANT:
    // Do NOT send menu automatically here.
    // Unknown messages simply do nothing.
    return;
  }

  // =================================================
  // NO STATE = NO REPLY
  // =================================================

  return;
}

// =====================================================
// WHATSAPP CONNECTION
// =====================================================

async function startBot() {
  const {
    state,
    saveCreds
  } = await useMultiFileAuthState(
    AUTH_DIR
  );

  let version;

  try {
    const latest =
      await fetchLatestBaileysVersion();

    version = latest.version;
  } catch (e) {
    version = [2, 3000, 1015901307];
  }

  const sock = makeWASocket({
    auth: state,
    version,
    logger: P({
      level: "silent"
    }),
    printQRInTerminal: false
  });

  sock.ev.on(
    "creds.update",
    saveCreds
  );

  sock.ev.on(
    "connection.update",
    async update => {

      const {
        connection,
        lastDisconnect,
        qr
      } = update;

      if (qr) {
        console.log("\n📱 Scan this QR with WhatsApp:\n");
        qrcode.generate(qr, { small: true });
      }

      if (connection === "connecting") {
        console.log("🔄 WhatsApp connecting...");
      }

      if (connection === "open") {

        global.waConnected = true;

        console.log("\n================================");
        console.log("✅ HANSA STORE BOT CONNECTED");
        console.log("================================\n");
      }

      if (connection === "close") {

        global.waConnected = false;

        const error = lastDisconnect?.error;

        const statusCode =
          error?.output?.statusCode ??
          error?.statusCode ??
          error?.data?.statusCode;

        const reason =
          error?.message ||
          error?.data?.message ||
          "Unknown";

        console.log("\n================================");
        console.log("❌ WHATSAPP CONNECTION CLOSED");
        console.log("================================");

        console.log("📌 Status:", statusCode ?? "unknown");
        console.log("📌 Reason:", reason);

        console.log(
          "📌 Error:",
          error?.toString?.() || "none"
        );

        // -----------------------------------------
        // LOGGED OUT
        // -----------------------------------------

        if (
          statusCode === DisconnectReason.loggedOut ||
          statusCode === 401
        ) {

          console.log(
            "❌ WhatsApp logged out."
          );

          console.log(
            "⚠️ Delete auth_info and pair again."
          );

          return;
        }


        // -----------------------------------------
        // CONNECTION REPLACED
        // -----------------------------------------

        if (statusCode === 440) {

          console.log(
            "⚠️ Connection replaced by another WhatsApp session."
          );

          return;
        }


        // -----------------------------------------
        // BAD SESSION
        // -----------------------------------------

        if (statusCode === 500) {

          console.log(
            "⚠️ WhatsApp session/server error."
          );
        }


        // -----------------------------------------
        // RECONNECT LOCK
        // -----------------------------------------

        if (global.reconnectTimer) {

          console.log(
            "⏳ Reconnect already scheduled."
          );

          return;
        }


        global.reconnectTimer = setTimeout(
          async () => {

            global.reconnectTimer = null;

            console.log(
              "\n🔄 Reconnecting WhatsApp..."
            );

            try {

              await startBot();

            } catch (e) {

              console.log(
                "❌ Reconnect error:",
                e.message
              );

            }

          },
          5000
        );
      }
    }
  );

  sock.ev.on(
    "messages.upsert",
    async ({ messages }) => {
      for (const msg of messages) {
        try {
          await handleMessage(
            sock,
            msg
          );
        } catch (e) {
          console.log(
            "Message handler error:",
            e.message
          );
        }
      }
    }
  );
}

// =====================================================
// HTTP HEALTH SERVER (FOR CLOUD HOSTING)
// =====================================================

const http = require("http");

const PORT = process.env.PORT || 3000;

http.createServer((req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/plain; charset=utf-8"
  });
  res.end("HANSA STORE BOT ONLINE");
}).listen(PORT, "0.0.0.0", () => {
  console.log(`🌐 HTTP server listening on port ${PORT}`);
});

// =====================================================
// START
// =====================================================

startBot().catch(err => {
  console.error(
    "❌ BOT ERROR:",
    err
  );
});
