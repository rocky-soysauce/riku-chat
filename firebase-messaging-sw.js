// =============================================================================
// firebase-messaging-sw.js
// このファイルは「リポジトリのルート」に置いてください（index.htmlと同じ階層）。
// ブラウザがタブを閉じている／バックグラウンドの間でも通知を受け取るための
// Service Worker です。中身は基本的に書き換え不要ですが、
// firebaseConfig だけは index.html と必ず同じ値にしてください。
// =============================================================================

importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");

// index.html の firebaseConfig と同じ値にしてください
firebase.initializeApp({
  apiKey: "AIzaSyDYHvcPCWDNdePaPr1iV78PdH85BmQB8OM",
  authDomain: "riku-chat-c3b3d.firebaseapp.com",
  projectId: "riku-chat-c3b3d",
  storageBucket: "riku-chat-c3b3d.firebasestorage.app",
  messagingSenderId: "401508615370",
  appId: "1:401508615370:web:a596b4e945d6c4ec9f6033"
});

const messaging = firebase.messaging();

// バックグラウンド（タブが非アクティブ／閉じている）で通知を受け取ったときの処理
messaging.onBackgroundMessage(function (payload) {
  console.log("[firebase-messaging-sw.js] バックグラウンド通知を受信:", payload);

  var data = payload.data || {};
  var title = data.title || "RIKU Chat";
  var body = data.body || "新しいメッセージがあります";
  var roomId = data.roomId || "";

  var notificationOptions = {
    body: body,
    icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCI+CiAgPHJlY3QgeD0iMCIgeT0iMCIgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiByeD0iMTQiIGZpbGw9IiMyNTYzZWIiLz4KICA8cmVjdCB4PSIxMiIgeT0iMTQiIHdpZHRoPSI0MCIgaGVpZ2h0PSIyNiIgcng9IjgiIGZpbGw9IiNmZmZmZmYiLz4KICA8cGF0aCBkPSJNMjAgNDAgTDIwIDUwIEwzMCA0MCBaIiBmaWxsPSIjZmZmZmZmIi8+CiAgPGNpcmNsZSBjeD0iMjQiIGN5PSIyNyIgcj0iMyIgZmlsbD0iIzI1NjNlYiIvPgogIDxjaXJjbGUgY3g9IjMyIiBjeT0iMjciIHI9IjMiIGZpbGw9IiMyNTYzZWIiLz4KICA8Y2lyY2xlIGN4PSI0MCIgY3k9IjI3IiByPSIzIiBmaWxsPSIjMjU2M2ViIi8+Cjwvc3ZnPgo=",
    badge: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCI+CiAgPHJlY3QgeD0iMCIgeT0iMCIgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiByeD0iMTQiIGZpbGw9IiMyNTYzZWIiLz4KPC9zdmc+Cg==",
    tag: roomId || "riku-chat-notify",
    renotify: true,
    data: { roomId: roomId, url: self.registration.scope }
  };

  self.registration.showNotification(title, notificationOptions);
});

// 通知をクリックしたらアプリを開く／既に開いていればそのタブにフォーカス
self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var targetUrl = (event.notification.data && event.notification.data.url) || self.registration.scope;

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (clientList) {
      for (var i = 0; i < clientList.length; i++) {
        var client = clientList[i];
        if (client.url.indexOf(self.registration.scope) === 0 && "focus" in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});