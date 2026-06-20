/* ===========================================================================
   Web Chat - app.js
   Firebase（Firestore + 匿名認証）と連携するメインスクリプト。
   このファイルは <script type="module"> として index.html から読み込まれます
   （import文を使うため module 指定が必須です）。
   =========================================================================== */

  import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
  import {
    getAuth,
    signInAnonymously,
    onAuthStateChanged
  } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
  import {
    getFirestore,
    collection,
    doc,
    addDoc,
    setDoc,
    updateDoc,
    deleteDoc,
    onSnapshot,
    getDocs,
    query,
    orderBy,
    serverTimestamp
  } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

  /* =========================================================
     Firebaseプロジェクトの設定値
     ========================================================= */
  const firebaseConfig = {
    apiKey: "AIzaSyDYHvcPCWDNdePaPr1iV78PdH85BmQB8OM",
    authDomain: "riku-chat-c3b3d.firebaseapp.com",
    projectId: "riku-chat-c3b3d",
    storageBucket: "riku-chat-c3b3d.firebasestorage.app",
    messagingSenderId: "401508615370",
    appId: "1:401508615370:web:a596b4e945d6c4ec9f6033"
  };

  const firebaseApp = initializeApp(firebaseConfig);
  const auth = getAuth(firebaseApp);
  const db = getFirestore(firebaseApp);

  // このファイル内の後半部分（メインロジック）から使えるように window に橋渡しする
  window.__firebase = {
    auth, db,
    signInAnonymously, onAuthStateChanged,
    collection, doc, addDoc, setDoc, updateDoc, deleteDoc,
    onSnapshot, getDocs, query, orderBy, serverTimestamp
  };
  window.dispatchEvent(new Event("firebase-ready"));

(function () {
  "use strict";

  /* =========================================================
     設定値
     ========================================================= */
  var MAX_LENGTH = 2000;
  var MAX_NAME_LENGTH = 20;
  var MAX_ROOM_NAME_LENGTH = 30;
  var MAX_PASS_LENGTH = 30;
  var RATE_LIMIT_MS = 600;
  var NAME_STORAGE_KEY = "webchat_my_name";
  var REACTION_EMOJIS = ["👍", "❤️", "😂", "😢", "😮"]; // メッセージに付けられるスタンプの種類

  /* =========================================================
     状態管理
     ========================================================= */
  var state = {
    myName: "",
    myUid: null,
    roomDisplayName: "", // 入室中の部屋内で実際に使う表示名（同名がいる場合は連番が付く）
    rooms: [],            // Firestoreから取得した部屋一覧（リアルタイム同期）
    currentRoomId: null,
    currentMessages: [],  // 現在の部屋のメッセージ（リアルタイム同期）
    roomsUnsub: null,
    messagesUnsub: null
  };
  var lastSendTime = 0;
  var fb = null; // window.__firebase が入る

  /* =========================================================
     DOM参照
     ========================================================= */
  var $appRoot = document.getElementById("app-root");
  var $banner = document.getElementById("error-banner");
  var $bannerText = document.getElementById("error-banner-text");
  var $bannerReloadBtn = document.getElementById("banner-reload-btn");

  var $screenLoading = document.getElementById("screen-loading");
  var $screenName = document.getElementById("screen-name");
  var $screenRooms = document.getElementById("screen-rooms");
  var $screenCreateRoom = document.getElementById("screen-create-room");
  var $screenJoinPasscode = document.getElementById("screen-join-passcode");
  var $screenChat = document.getElementById("screen-chat");

  var $nameForm = document.getElementById("name-form");
  var $nameInput = document.getElementById("name-input");
  var $nameField = document.getElementById("name-field");

  var $meChipName = document.getElementById("me-chip-name");
  var $changeNameBtn = document.getElementById("change-name-btn");
  var $roomList = document.getElementById("room-list");
  var $newRoomBtn = document.getElementById("new-room-btn");

  var $createRoomForm = document.getElementById("create-room-form");
  var $roomNameInput = document.getElementById("room-name-input");
  var $roomNameField = document.getElementById("room-name-field");
  var $roomPassInput = document.getElementById("room-pass-input");
  var $roomPassField = document.getElementById("room-pass-field");
  var $createRoomCancelBtn = document.getElementById("create-room-cancel-btn");
  var $createRoomSubmitBtn = document.getElementById("create-room-submit-btn");

  var $joinForm = document.getElementById("join-form");
  var $joinRoomTitle = document.getElementById("join-room-title");
  var $joinPassInput = document.getElementById("join-pass-input");
  var $joinPassField = document.getElementById("join-pass-field");
  var $joinCancelBtn = document.getElementById("join-cancel-btn");
  var $joinSubmitBtn = document.getElementById("join-submit-btn");

  var $messages = document.getElementById("messages");
  var $input = document.getElementById("msg-input");
  var $sendBtn = document.getElementById("send-btn");
  var $charCount = document.getElementById("char-count");
  var $themeBtn = document.getElementById("theme-toggle");
  var $themeBtnFloating = document.getElementById("theme-toggle-floating");
  var $leaveRoomBtn = document.getElementById("leave-room-btn");
  var $deleteRoomBtn = document.getElementById("delete-room-btn");
  var $roomAvatar = document.getElementById("room-avatar");
  var $roomTitleText = document.getElementById("room-title-text");
  var $roomMemberCount = document.getElementById("room-member-count");

  var $confirmModal = document.getElementById("confirm-modal");
  var $confirmModalTitle = document.getElementById("confirm-modal-title");
  var $confirmModalText = document.getElementById("confirm-modal-text");
  var $confirmModalOk = document.getElementById("confirm-modal-ok");
  var $confirmModalCancel = document.getElementById("confirm-modal-cancel");

  var pendingRoomIdToJoin = null;

  /* =========================================================
     共通ユーティリティ
     ========================================================= */
  function showError(message, opts) {
    opts = opts || {};
    $bannerText.textContent = message;
    $banner.classList.add("show");
    $bannerReloadBtn.classList.toggle("hidden", !opts.showReload);

    window.clearTimeout(showError._t);
    if (!opts.persistent) {
      showError._t = window.setTimeout(function () { $banner.classList.remove("show"); }, 4500);
    }
  }
  function hideError() {
    window.clearTimeout(showError._t);
    $banner.classList.remove("show");
  }
  $bannerReloadBtn.addEventListener("click", function () { window.location.reload(); });

  function showScreen(el) {
    [$screenLoading, $screenName, $screenRooms, $screenCreateRoom, $screenJoinPasscode, $screenChat].forEach(function (s) {
      s.classList.add("hidden");
    });
    el.classList.remove("hidden");
    // チャット画面にはヘッダー内に専用のテーマボタンがあるため、
    // フローティングボタンはホーム画面系でのみ表示する
    $themeBtnFloating.classList.toggle("hidden", el === $screenChat);
  }

  function sanitizeText(raw, maxLen) {
    if (typeof raw !== "string") return "";
    var cleaned = raw.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
    cleaned = cleaned.trim();
    if (typeof maxLen === "number" && cleaned.length > maxLen) cleaned = cleaned.slice(0, maxLen);
    return cleaned;
  }
  function sanitizeMessageText(raw, maxLen) {
    if (typeof raw !== "string") return "";
    var cleaned = raw.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
    cleaned = cleaned.trim();
    if (cleaned.length > maxLen) cleaned = cleaned.slice(0, maxLen);
    return cleaned;
  }

  var URL_PATTERN = /(https?:\/\/[^\s<>"']+)/g;
  function renderSafeText(container, text) {
    var lastIndex = 0;
    var match;
    URL_PATTERN.lastIndex = 0;
    while ((match = URL_PATTERN.exec(text)) !== null) {
      var url = match[0];
      if (match.index > lastIndex) container.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
      if (/^https?:\/\//i.test(url)) {
        var a = document.createElement("a");
        a.href = url; a.textContent = url; a.target = "_blank"; a.rel = "noopener noreferrer nofollow";
        container.appendChild(a);
      } else {
        container.appendChild(document.createTextNode(url));
      }
      lastIndex = match.index + url.length;
    }
    if (lastIndex < text.length) container.appendChild(document.createTextNode(text.slice(lastIndex)));
  }

  function formatTime(date) {
    if (!date) return "";
    var h = String(date.getHours()).padStart(2, "0");
    var m = String(date.getMinutes()).padStart(2, "0");
    return h + ":" + m;
  }

  function setFieldError(fieldEl, hasError) { fieldEl.classList.toggle("has-error", !!hasError); }

  // 合言葉のハッシュ化（SHA-256, 16進文字列）。Web Crypto APIを利用（HTTPS環境で利用可能）
  function hashPasscode(text) {
    var enc = new TextEncoder();
    var data = enc.encode(text);
    return crypto.subtle.digest("SHA-256", data).then(function (buf) {
      var bytes = new Uint8Array(buf);
      var hex = "";
      for (var i = 0; i < bytes.length; i++) {
        hex += bytes[i].toString(16).padStart(2, "0");
      }
      return hex;
    });
  }

  function setBusy(btn, busy, busyLabel, normalLabel) {
    btn.disabled = busy;
    btn.textContent = busy ? busyLabel : normalLabel;
  }

  /* =========================================================
     確認モーダル（汎用）
     ========================================================= */
  var confirmCallback = null;
  function openConfirmModal(title, text, onConfirm) {
    $confirmModalTitle.textContent = title;
    $confirmModalText.textContent = text;
    confirmCallback = onConfirm;
    $confirmModal.classList.remove("hidden");
  }
  function closeConfirmModal() { $confirmModal.classList.add("hidden"); confirmCallback = null; }
  $confirmModalCancel.addEventListener("click", closeConfirmModal);
  $confirmModalOk.addEventListener("click", function () {
    var cb = confirmCallback;
    closeConfirmModal();
    if (typeof cb === "function") cb();
  });
  $confirmModal.addEventListener("click", function (e) { if (e.target === $confirmModal) closeConfirmModal(); });

  /* =========================================================
     名前設定（localStorageに保存。Firestoreには送らない）
     ========================================================= */
  function loadSavedName() {
    try { return localStorage.getItem(NAME_STORAGE_KEY) || ""; }
    catch (e) { return ""; }
  }
  function saveName(name) {
    try { localStorage.setItem(NAME_STORAGE_KEY, name); }
    catch (e) { /* プライベートモード等で失敗しても致命的ではないため無視 */ }
  }

  function goToNameScreen() {
    $nameInput.value = state.myName || loadSavedName() || "";
    setFieldError($nameField, false);
    showScreen($screenName);
    window.setTimeout(function () { $nameInput.focus(); }, 0);
  }

  $nameForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var name = sanitizeText($nameInput.value, MAX_NAME_LENGTH);
    if (name.length === 0) {
      setFieldError($nameField, true);
      $nameInput.focus();
      return;
    }
    setFieldError($nameField, false);
    state.myName = name;
    saveName(name);
    showScreen($screenRooms);
    subscribeRooms();
  });

  $changeNameBtn.addEventListener("click", function () { goToNameScreen(); });

  /* =========================================================
     画面2: 部屋選択（Firestoreの "rooms" コレクションをリアルタイム購読）
     ========================================================= */
  function subscribeRooms() {
    $meChipName.textContent = state.myName;
    if (state.roomsUnsub) { state.roomsUnsub(); state.roomsUnsub = null; }

    $roomList.innerHTML = "";
    var loading = document.createElement("div");
    loading.className = "loading-state";
    loading.innerHTML = '<div class="spinner" aria-hidden="true"></div><div>部屋一覧を読み込み中…</div>';
    $roomList.appendChild(loading);

    var roomsCol = fb.collection(fb.db, "rooms");
    var q = fb.query(roomsCol, fb.orderBy("createdAt", "desc"));
    state.roomsUnsub = fb.onSnapshot(q, function (snapshot) {
      state.rooms = [];
      snapshot.forEach(function (docSnap) {
        var data = docSnap.data();
        state.rooms.push({
          id: docSnap.id,
          name: data.name || "",
          passHash: data.passHash || "",
          createdAt: data.createdAt
        });
      });
      renderRoomList();
    }, function (err) {
      console.error(err);
      showError("部屋一覧の取得に失敗しました。通信環境をご確認ください。");
    });
  }

  function renderRoomList() {
    $roomList.innerHTML = "";
    if (state.rooms.length === 0) {
      var empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "まだ部屋がありません。「新しい部屋を作る」から作成してください。";
      $roomList.appendChild(empty);
      return;
    }
    state.rooms.forEach(function (room) {
      var item = document.createElement("div");
      item.className = "room-item";
      item.setAttribute("role", "button");
      item.setAttribute("tabindex", "0");

      var icon = document.createElement("div");
      icon.className = "room-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path></svg>';

      var info = document.createElement("div");
      info.className = "room-info";

      var nameEl = document.createElement("div");
      nameEl.className = "room-name";
      nameEl.textContent = room.name;

      var metaEl = document.createElement("div");
      metaEl.className = "room-meta";
      var lockTag = document.createElement("span");
      lockTag.className = "lock-tag";
      lockTag.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>';
      var lockText = document.createElement("span");
      lockText.textContent = "合言葉が必要";
      lockTag.appendChild(lockText);
      metaEl.appendChild(lockTag);
      info.appendChild(nameEl);
      info.appendChild(metaEl);

      var deleteBtn = document.createElement("button");
      deleteBtn.className = "room-delete";
      deleteBtn.setAttribute("aria-label", room.name + " を削除");
      deleteBtn.title = "この部屋を削除";
      deleteBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"></path></svg>';
      deleteBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        confirmDeleteRoom(room.id);
      });

      item.appendChild(icon);
      item.appendChild(info);
      item.appendChild(deleteBtn);

      function openJoin() { startJoinFlow(room.id); }
      item.addEventListener("click", openJoin);
      item.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openJoin(); }
      });

      $roomList.appendChild(item);
    });
  }

  function confirmDeleteRoom(roomId) {
    var room = state.rooms.find(function (r) { return r.id === roomId; });
    if (!room) return;
    openConfirmModal(
      "部屋を削除しますか？",
      "「" + room.name + "」とそのすべてのメッセージが削除されます。この操作は取り消せません。",
      function () { deleteRoomFromFirestore(roomId); }
    );
  }

  function deleteRoomFromFirestore(roomId) {
    var messagesCol = fb.collection(fb.db, "rooms", roomId, "messages");
    var presenceCol = fb.collection(fb.db, "rooms", roomId, "presence");
    Promise.all([fb.getDocs(messagesCol), fb.getDocs(presenceCol)]).then(function (results) {
      var messagesSnap = results[0];
      var presenceSnap = results[1];
      var deletions = [];
      messagesSnap.forEach(function (docSnap) {
        deletions.push(fb.deleteDoc(fb.doc(fb.db, "rooms", roomId, "messages", docSnap.id)));
      });
      presenceSnap.forEach(function (docSnap) {
        deletions.push(fb.deleteDoc(fb.doc(fb.db, "rooms", roomId, "presence", docSnap.id)));
      });
      return Promise.all(deletions);
    }).then(function () {
      return fb.deleteDoc(fb.doc(fb.db, "rooms", roomId));
    }).then(function () {
      if (state.currentRoomId === roomId) {
        unsubscribeMessages();
        stopPresence();
        state.currentRoomId = null;
        showScreen($screenRooms);
      }
    }).catch(function (err) {
      console.error(err);
      showDeleteError(err);
    });
  }

  // 権限エラー（Firestoreセキュリティルールによる拒否）の場合は、
  // 原因が分かりやすいメッセージを表示する
  function showDeleteError(err) {
    if (err && (err.code === "permission-denied" || /permission/i.test(String(err.message || "")))) {
      showError("部屋の削除がFirestoreのルールによって拒否されました。セキュリティルールの設定をご確認ください。");
    } else {
      showError("部屋の削除に失敗しました。通信環境をご確認ください。");
    }
  }

  $newRoomBtn.addEventListener("click", function () {
    $roomNameInput.value = "";
    $roomPassInput.value = "";
    setFieldError($roomNameField, false);
    setFieldError($roomPassField, false);
    showScreen($screenCreateRoom);
    window.setTimeout(function () { $roomNameInput.focus(); }, 0);
  });

  /* =========================================================
     画面3: 新規部屋作成
     ========================================================= */
  $createRoomForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var roomName = sanitizeText($roomNameInput.value, MAX_ROOM_NAME_LENGTH);
    var roomPass = sanitizeText($roomPassInput.value, MAX_PASS_LENGTH);

    var hasError = false;
    if (roomName.length === 0) { setFieldError($roomNameField, true); hasError = true; }
    else { setFieldError($roomNameField, false); }
    if (roomPass.length === 0) { setFieldError($roomPassField, true); hasError = true; }
    else { setFieldError($roomPassField, false); }
    if (hasError) return;

    setBusy($createRoomSubmitBtn, true, "作成中…", "部屋を作成");

    hashPasscode(roomPass).then(function (passHash) {
      var roomsCol = fb.collection(fb.db, "rooms");
      return fb.addDoc(roomsCol, {
        name: roomName,
        passHash: passHash,
        createdAt: fb.serverTimestamp(),
        createdBy: state.myUid
      });
    }).then(function (docRef) {
      setBusy($createRoomSubmitBtn, false, "作成中…", "部屋を作成");
      enterRoom(docRef.id, roomName);
    }).catch(function (err) {
      console.error(err);
      setBusy($createRoomSubmitBtn, false, "作成中…", "部屋を作成");
      showError("部屋の作成に失敗しました。通信環境をご確認ください。");
    });
  });

  $createRoomCancelBtn.addEventListener("click", function () { showScreen($screenRooms); });

  /* =========================================================
     画面4: 入室パスコード確認
     ========================================================= */
  function startJoinFlow(roomId) {
    var room = state.rooms.find(function (r) { return r.id === roomId; });
    if (!room) return;
    pendingRoomIdToJoin = roomId;
    $joinRoomTitle.textContent = room.name + " に入る";
    $joinPassInput.value = "";
    setFieldError($joinPassField, false);
    showScreen($screenJoinPasscode);
    window.setTimeout(function () { $joinPassInput.focus(); }, 0);
  }

  $joinForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var room = state.rooms.find(function (r) { return r.id === pendingRoomIdToJoin; });
    if (!room) { showScreen($screenRooms); return; }

    var inputPass = sanitizeText($joinPassInput.value, MAX_PASS_LENGTH);
    setBusy($joinSubmitBtn, true, "確認中…", "入室する");

    hashPasscode(inputPass).then(function (hash) {
      setBusy($joinSubmitBtn, false, "確認中…", "入室する");
      if (hash !== room.passHash) {
        setFieldError($joinPassField, true);
        $joinPassInput.focus();
        $joinPassInput.select();
        return;
      }
      setFieldError($joinPassField, false);
      enterRoom(room.id, room.name);
    });
  });

  $joinCancelBtn.addEventListener("click", function () {
    pendingRoomIdToJoin = null;
    showScreen($screenRooms);
  });

  /* =========================================================
     画面5: チャット（Firestoreの rooms/{roomId}/messages をリアルタイム購読）
     ========================================================= */
  function enterRoom(roomId, roomName) {
    state.currentRoomId = roomId;
    state.roomDisplayName = state.myName; // 重複チェック完了までの暫定値
    $roomTitleText.textContent = roomName;
    $roomAvatar.textContent = roomName.charAt(0);
    $roomMemberCount.textContent = "オンライン: -人";

    showScreen($screenChat);
    updateCharCount();
    updateSendButtonState();
    subscribeMessages(roomId);
    startPresence(roomId);
    window.setTimeout(function () { $input.focus(); }, 0);
  }

  function subscribeMessages(roomId) {
    unsubscribeMessages();
    $messages.innerHTML = "";
    var loading = document.createElement("div");
    loading.className = "loading-state";
    loading.innerHTML = '<div class="spinner" aria-hidden="true"></div><div>メッセージを読み込み中…</div>';
    $messages.appendChild(loading);

    var messagesCol = fb.collection(fb.db, "rooms", roomId, "messages");
    var q = fb.query(messagesCol, fb.orderBy("createdAt", "asc"));
    state.messagesUnsub = fb.onSnapshot(q, function (snapshot) {
      state.currentMessages = [];
      snapshot.forEach(function (docSnap) {
        var data = docSnap.data();
        state.currentMessages.push({
          id: docSnap.id,
          uid: data.uid || "",
          name: data.name || "",
          text: data.text || "",
          deleted: !!data.deleted,
          reactions: data.reactions || {},
          createdAt: data.createdAt ? data.createdAt.toDate() : null
        });
      });
      renderAllMessages();
    }, function (err) {
      console.error(err);
      showError("メッセージの取得に失敗しました。通信環境をご確認ください。");
    });
  }

  function unsubscribeMessages() {
    if (state.messagesUnsub) { state.messagesUnsub(); state.messagesUnsub = null; }
    state.currentMessages = [];
  }

  /* =========================================================
     プレゼンス機能（簡易オンライン人数表示）
     rooms/{roomId}/presence/{uid} に自分の在室情報を書き込み、
     一定間隔でハートビート更新する。ある程度時間が経って更新が
     止まっているユーザーはオフライン扱いとしてカウントしない。
     ========================================================= */
  var PRESENCE_HEARTBEAT_MS = 20000;   // 20秒ごとに在室を更新
  var PRESENCE_STALE_MS = 45000;       // 45秒更新が無ければオフライン扱い
  var presenceHeartbeatTimer = null;
  var presenceUnsub = null;

  function startPresence(roomId) {
    stopPresence();
    if (!state.myUid) return;

    var presenceCol = fb.collection(fb.db, "rooms", roomId, "presence");

    // 入室時に一度だけ、同じ部屋に同名の人がいないか確認し、
    // 重複していれば「name(2)」のように連番を付けた表示名を使う
    fb.getDocs(presenceCol).then(function (snapshot) {
      var usedNames = [];
      snapshot.forEach(function (docSnap) {
        if (docSnap.id === state.myUid) return; // 自分自身は比較対象から除く
        var data = docSnap.data();
        var lastSeen = data.lastSeen ? data.lastSeen.toDate().getTime() : 0;
        if (Date.now() - lastSeen < PRESENCE_STALE_MS && data.name) {
          usedNames.push(data.name);
        }
      });
      state.roomDisplayName = resolveUniqueName(state.myName, usedNames);
      if (state.roomDisplayName !== state.myName) {
        // 同名の人がいたため連番が付いたことを、控えめに一度だけ知らせる
        showError("この部屋には同じ名前の人がいるため、今回は「" + state.roomDisplayName + "」として表示されます。");
      }
      beginPresenceHeartbeatAndSubscription(roomId);
    }).catch(function (err) {
      console.error("presence lookup failed", err);
      // 重複チェックに失敗しても通常名のまま参加できるようにする
      state.roomDisplayName = state.myName;
      beginPresenceHeartbeatAndSubscription(roomId);
    });
  }

  // 既に使われている名前一覧の中で重複しないよう、必要なら "(2)" のように連番を付ける
  function resolveUniqueName(baseName, usedNames) {
    if (usedNames.indexOf(baseName) === -1) return baseName;
    var n = 2;
    while (usedNames.indexOf(baseName + "(" + n + ")") !== -1) {
      n += 1;
    }
    return baseName + "(" + n + ")";
  }

  function beginPresenceHeartbeatAndSubscription(roomId) {
    var presenceRef = fb.doc(fb.db, "rooms", roomId, "presence", state.myUid);
    var writeHeartbeat = function () {
      fb.setDoc(presenceRef, {
        name: state.roomDisplayName,
        lastSeen: fb.serverTimestamp()
      }).catch(function (err) {
        // プレゼンス更新の失敗は致命的ではないため、コンソールにのみ記録
        console.error("presence update failed", err);
      });
    };
    writeHeartbeat();
    presenceHeartbeatTimer = window.setInterval(writeHeartbeat, PRESENCE_HEARTBEAT_MS);

    var presenceCol = fb.collection(fb.db, "rooms", roomId, "presence");
    presenceUnsub = fb.onSnapshot(presenceCol, function (snapshot) {
      var now = Date.now();
      var onlineCount = 0;
      snapshot.forEach(function (docSnap) {
        var data = docSnap.data();
        var lastSeen = data.lastSeen ? data.lastSeen.toDate().getTime() : 0;
        if (now - lastSeen < PRESENCE_STALE_MS) onlineCount += 1;
      });
      if (onlineCount < 1) onlineCount = 1; // 自分が見えている以上は最低1人
      $roomMemberCount.textContent = "オンライン: " + onlineCount + "人";
    }, function (err) {
      console.error("presence subscribe failed", err);
    });

    // タブを閉じる/離脱する際にできるだけ在室情報を消す（成功は保証されない）
    window.addEventListener("beforeunload", removeOwnPresenceOnce);
  }

  function removeOwnPresenceOnce() {
    if (!state.currentRoomId || !state.myUid) return;
    var presenceRef = fb.doc(fb.db, "rooms", state.currentRoomId, "presence", state.myUid);
    fb.deleteDoc(presenceRef).catch(function () { /* 離脱時の失敗は無視 */ });
  }

  function stopPresence() {
    if (presenceHeartbeatTimer) { window.clearInterval(presenceHeartbeatTimer); presenceHeartbeatTimer = null; }
    if (presenceUnsub) { presenceUnsub(); presenceUnsub = null; }
    window.removeEventListener("beforeunload", removeOwnPresenceOnce);
    removeOwnPresenceOnce();
  }

  function renderAllMessages() {
    $messages.innerHTML = "";
    state.currentMessages.forEach(function (m) {
      $messages.appendChild(buildMessageRowElement(m));
    });
    scrollToBottom();
  }

  function buildMessageRowElement(m) {
    var isMe = m.uid === state.myUid;
    var row = document.createElement("div");
    row.className = "msg-row " + (isMe ? "me" : "other");
    row.dataset.id = m.id;

    var wrap = document.createElement("div");
    wrap.className = "bubble-wrap";

    if (!isMe) {
      var nameEl = document.createElement("div");
      nameEl.className = "sender-name";
      nameEl.textContent = m.name; // textContent でXSS対策
      wrap.appendChild(nameEl);
    }

    var line = document.createElement("div");
    line.className = "bubble-line";

    var bubble = document.createElement("div");
    bubble.className = "bubble" + (m.deleted ? " deleted" : "");
    if (m.deleted) {
      bubble.textContent = "このメッセージは削除されました";
    } else {
      renderSafeText(bubble, m.text);
    }
    line.appendChild(bubble);

    if (isMe && !m.deleted) {
      var delBtn = document.createElement("button");
      delBtn.className = "msg-delete-btn";
      delBtn.setAttribute("aria-label", "このメッセージを削除");
      delBtn.title = "削除";
      delBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path></svg>';
      delBtn.addEventListener("click", function () { deleteMessage(m.id); });
      line.appendChild(delBtn);
    }

    if (!m.deleted) {
      var reactionToggleBtn = document.createElement("button");
      reactionToggleBtn.className = "reaction-add-btn";
      reactionToggleBtn.setAttribute("aria-label", "スタンプを付ける");
      reactionToggleBtn.title = "スタンプを付ける";
      reactionToggleBtn.textContent = "🙂";
      reactionToggleBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        togglePickerFor(m.id, reactionToggleBtn);
      });
      line.appendChild(reactionToggleBtn);
    }

    var meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = formatTime(m.createdAt);

    wrap.appendChild(line);
    if (!m.deleted) {
      wrap.appendChild(buildReactionBar(m));
    }
    wrap.appendChild(meta);
    row.appendChild(wrap);
    return row;
  }

  // すでに押されているリアクションを集計バッジとして表示する行
  function buildReactionBar(m) {
    var bar = document.createElement("div");
    bar.className = "reaction-bar";
    var reactions = m.reactions || {};

    REACTION_EMOJIS.forEach(function (emoji) {
      var uids = reactions[emoji] || [];
      if (uids.length === 0) return; // 誰も押していない絵文字は表示しない
      var pressedByMe = uids.indexOf(state.myUid) !== -1;

      var chip = document.createElement("button");
      chip.className = "reaction-chip" + (pressedByMe ? " active" : "");
      chip.setAttribute("aria-label", emoji + " " + uids.length + "件");
      chip.title = pressedByMe ? "自分も含めて" + uids.length + "人が反応" : uids.length + "人が反応";

      var emojiSpan = document.createElement("span");
      emojiSpan.textContent = emoji;
      var countSpan = document.createElement("span");
      countSpan.className = "reaction-count";
      countSpan.textContent = String(uids.length);

      chip.appendChild(emojiSpan);
      chip.appendChild(countSpan);
      chip.addEventListener("click", function () { toggleReaction(m.id, emoji); });
      bar.appendChild(chip);
    });

    return bar;
  }

  // 「🙂」ボタンを押したときに出す、5種類から選べるピッカー
  var openPickerEl = null;
  function togglePickerFor(messageId, anchorBtn) {
    if (openPickerEl) {
      var prev = openPickerEl;
      openPickerEl = null;
      prev.remove();
      if (prev.dataset.forMessageId === messageId) return; // 同じボタンをもう一度押したら閉じるだけ
    }
    var picker = document.createElement("div");
    picker.className = "reaction-picker";
    picker.dataset.forMessageId = messageId;
    REACTION_EMOJIS.forEach(function (emoji) {
      var btn = document.createElement("button");
      btn.className = "reaction-picker-btn";
      btn.textContent = emoji;
      btn.setAttribute("aria-label", emoji + "を付ける");
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        toggleReaction(messageId, emoji);
        closeOpenPicker();
      });
      picker.appendChild(btn);
    });
    anchorBtn.insertAdjacentElement("afterend", picker);
    openPickerEl = picker;
  }
  function closeOpenPicker() {
    if (openPickerEl) { openPickerEl.remove(); openPickerEl = null; }
  }
  // ピッカー外をクリックしたら閉じる
  document.addEventListener("click", function () { closeOpenPicker(); });

  function toggleReaction(messageId, emoji) {
    if (!state.currentRoomId || !state.myUid) return;
    var msg = state.currentMessages.find(function (mm) { return mm.id === messageId; });
    if (!msg) return;
    var current = (msg.reactions && msg.reactions[emoji]) || [];
    var alreadyPressed = current.indexOf(state.myUid) !== -1;
    var nextUids = alreadyPressed
      ? current.filter(function (u) { return u !== state.myUid; })
      : current.concat([state.myUid]);

    var nextReactions = {};
    REACTION_EMOJIS.forEach(function (e) {
      var list = (e === emoji) ? nextUids : ((msg.reactions && msg.reactions[e]) || []);
      if (list.length > 0) nextReactions[e] = list;
    });

    var msgRef = fb.doc(fb.db, "rooms", state.currentRoomId, "messages", messageId);
    fb.updateDoc(msgRef, { reactions: nextReactions }).catch(function (err) {
      console.error(err);
      showError("スタンプの送信に失敗しました。");
    });
  }

  function deleteMessage(messageId) {
    if (!state.currentRoomId) return;
    var msgRef = fb.doc(fb.db, "rooms", state.currentRoomId, "messages", messageId);
    fb.updateDoc(msgRef, { deleted: true, text: "", reactions: {} }).catch(function (err) {
      console.error(err);
      if (err && (err.code === "permission-denied" || /permission/i.test(String(err.message || "")))) {
        showError("メッセージの削除がFirestoreのルールによって拒否されました。");
      } else {
        showError("メッセージの削除に失敗しました。");
      }
    });
  }

  function scrollToBottom() {
    requestAnimationFrame(function () { $messages.scrollTop = $messages.scrollHeight; });
  }

  function updateSendButtonState() {
    var hasText = $input.value.trim().length > 0;
    $sendBtn.disabled = !hasText;
  }
  function updateCharCount() {
    var len = $input.value.length;
    $charCount.textContent = len + " / " + MAX_LENGTH;
    $charCount.classList.toggle("warn", len >= MAX_LENGTH);
  }
  function autoResizeTextarea() {
    $input.style.height = "auto";
    var newHeight = Math.min($input.scrollHeight, 140);
    $input.style.height = newHeight + "px";
  }

  function handleSend() {
    if (!state.currentRoomId) return;
    var now = Date.now();
    if (now - lastSendTime < RATE_LIMIT_MS) return;

    var text = sanitizeMessageText($input.value, MAX_LENGTH);
    if (text.length === 0) return;

    lastSendTime = now;
    $input.value = "";
    updateCharCount();
    updateSendButtonState();
    autoResizeTextarea();
    $input.focus();

    var messagesCol = fb.collection(fb.db, "rooms", state.currentRoomId, "messages");
    fb.addDoc(messagesCol, {
      uid: state.myUid,
      name: state.roomDisplayName || state.myName,
      text: text,
      deleted: false,
      reactions: {},
      createdAt: fb.serverTimestamp()
    }).catch(function (err) {
      console.error(err);
      showError("送信に失敗しました。通信環境をご確認ください。");
      // 失敗した内容を入力欄に戻し、書き直さずに再送できるようにする
      $input.value = text;
      updateCharCount();
      updateSendButtonState();
      autoResizeTextarea();
    });
  }

  /* =========================================================
     部屋からの退出・削除
     ========================================================= */
  $leaveRoomBtn.addEventListener("click", function () {
    unsubscribeMessages();
    stopPresence();
    state.currentRoomId = null;
    showScreen($screenRooms);
  });

  $deleteRoomBtn.addEventListener("click", function () {
    var roomId = state.currentRoomId;
    var room = state.rooms.find(function (r) { return r.id === roomId; });
    var roomName = room ? room.name : $roomTitleText.textContent;
    if (!roomId) return;
    openConfirmModal(
      "部屋を削除しますか？",
      "「" + roomName + "」とそのすべてのメッセージが削除されます。この操作は取り消せません。",
      function () { deleteRoomFromFirestore(roomId); }
    );
  });

  /* =========================================================
     入力イベント（チャット入力欄）
     ========================================================= */
  $input.addEventListener("keydown", function (e) {
    if (e.isComposing) return; // IME変換中のEnterは無視
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  });
  $input.addEventListener("input", function () { updateCharCount(); updateSendButtonState(); autoResizeTextarea(); });
  $input.addEventListener("paste", function () {
    window.setTimeout(function () {
      if ($input.value.length > MAX_LENGTH) $input.value = $input.value.slice(0, MAX_LENGTH);
      updateCharCount(); updateSendButtonState(); autoResizeTextarea();
    }, 0);
  });
  $sendBtn.addEventListener("click", handleSend);

  /* =========================================================
     テーマ切り替え・ネットワーク状態
     ========================================================= */
  var THEME_STORAGE_KEY = "webchat_theme";
  var VALID_THEMES = ["light", "dark", "blue", "green"];
  var $themeMenu = document.getElementById("theme-menu");
  var themeMenuItems = Array.prototype.slice.call(document.querySelectorAll(".theme-menu-item"));

  function applyTheme(theme) {
    if (VALID_THEMES.indexOf(theme) === -1) theme = "light";
    $appRoot.setAttribute("data-theme", theme);
    document.documentElement.setAttribute("data-theme", theme); // color-scheme切り替え用
    try { localStorage.setItem(THEME_STORAGE_KEY, theme); }
    catch (e) { /* プライベートモード等で失敗しても致命的ではないため無視 */ }

    themeMenuItems.forEach(function (item) {
      item.classList.toggle("active", item.dataset.themeValue === theme);
    });
  }

  function loadInitialTheme() {
    var saved = null;
    try { saved = localStorage.getItem(THEME_STORAGE_KEY); }
    catch (e) { /* 無視 */ }
    if (saved && VALID_THEMES.indexOf(saved) !== -1) {
      applyTheme(saved);
    } else if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
      applyTheme("dark"); // 端末側がダークモードならそれに合わせる（保存値が無い初回のみ）
    } else {
      applyTheme("light");
    }
  }
  loadInitialTheme();

  // テーマメニューを、指定したボタンの近くに開く
  function openThemeMenu(anchorBtn) {
    var isOpenForThisBtn = !$themeMenu.classList.contains("hidden") && $themeMenu.dataset.anchorId === anchorBtn.id;
    if (isOpenForThisBtn) { closeThemeMenu(); return; }

    var appRect = $appRoot.getBoundingClientRect();
    var btnRect = anchorBtn.getBoundingClientRect();
    var top = btnRect.bottom - appRect.top + 6;
    var right = appRect.right - btnRect.right;

    $themeMenu.style.top = top + "px";
    $themeMenu.style.right = right + "px";
    $themeMenu.style.left = "auto";
    $themeMenu.dataset.anchorId = anchorBtn.id;
    $themeMenu.classList.remove("hidden");
  }
  function closeThemeMenu() {
    $themeMenu.classList.add("hidden");
  }

  $themeBtn.addEventListener("click", function (e) { e.stopPropagation(); openThemeMenu($themeBtn); });
  $themeBtnFloating.addEventListener("click", function (e) { e.stopPropagation(); openThemeMenu($themeBtnFloating); });

  themeMenuItems.forEach(function (item) {
    item.addEventListener("click", function () {
      applyTheme(item.dataset.themeValue);
      closeThemeMenu();
    });
  });

  // メニュー外をクリックしたら閉じる（スタンプピッカーと同様の挙動）
  document.addEventListener("click", function (e) {
    if (!$themeMenu.classList.contains("hidden") && !$themeMenu.contains(e.target)) {
      closeThemeMenu();
    }
  });

  window.addEventListener("offline", function () {
    showError("ネットワーク接続がありません。再接続するまでお待ちください。", { persistent: true, showReload: true });
  });
  window.addEventListener("online", function () {
    hideError();
  });

  /* =========================================================
     Firebase 初期化・匿名ログイン
     ========================================================= */
  function initFirebaseAuth() {
    fb = window.__firebase;
    fb.onAuthStateChanged(fb.auth, function (user) {
      if (user) {
        state.myUid = user.uid;
        var saved = loadSavedName();
        if (saved) {
          state.myName = saved;
          showScreen($screenRooms);
          subscribeRooms();
        } else {
          goToNameScreen();
        }
      }
    });
    fb.signInAnonymously(fb.auth).catch(function (err) {
      console.error(err);
      showError("サーバーへの接続に失敗しました。", { persistent: true, showReload: true });
    });
  }

  if (window.__firebase) {
    initFirebaseAuth();
  } else {
    window.addEventListener("firebase-ready", initFirebaseAuth, { once: true });
  }
})();