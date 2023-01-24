let socket;
let roomName = '';

// (2) 退室時のUIリセット
const resetUI = () => {
  document.getElementById('roomName').disabled = false;
  document.getElementById('enterLeaveButton').innerText = '入室';
  document.getElementById('status').innerText = '[退室中]';
  document.getElementById('fromServer').innerHTML = '';
};

const connect = () => {
  // (3) 接続処理
  // ユーザ名をセットして送信
  socket = io('ws://localhost:8080/', {
    query: {
      roomName,
    },
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
  });

  socket.on('connect', socket => {
    document.getElementById('status').innerText = '[入室済]';
  });

  socket.on('connect_error', err => {
    let mes = '接続できません: ';
    // ログインしてない状態だと、chatserver.js は new Error('unauthorized') を返す
    if(err.message === 'unauthorized') {
      mes += '認証に失敗しました。';
    }
    alert(mes);
  });

  const parseChatMessage = obj => {
    if (obj.type === 'message') {
      document.getElementById('fromServer').innerHTML += `[${obj.roomName}] ${obj.name}: ${obj.data}<br />`;
    }
    else if (obj.type === 'enter') {
      document.getElementById('fromServer').innerHTML += `[${obj.roomName}] ${obj.name}が入室しました！<br />`;
    }
    else if (obj.type === 'leave') {
      document.getElementById('fromServer').innerHTML += `[${obj.roomName}] ${obj.name}が退室しました！<br />`;
    }
    else if (obj.type === 'typing') {
      document.getElementById('typing').innerText = `[${obj.roomName}] ${obj.name}が入力中です`;
      setTimeout(()=>{
        document.getElementById('typing').innerText = '';
      }, 1000);
    }   
  };

  // (4) メッセージ受信時の処理を追加
  socket.on('chat message', parseChatMessage);

  // 過去ログを受信
  socket.on('log', arr => arr.forEach(parseChatMessage));
  
  // (5) サーバから切断されたときの処理を追加
  socket.on('disconnect', reason => {
    console.log('Disconnected: ' + reason);
    if (reason === 'io server disconnect') {
      // サーバ側から切断された場合のみアラート表示
      alert('サーバから切断されました');
      socket = null;
      resetUI();
      return;
    }
    console.log('切断: ' + Date());
  });

  // 再接続を試行
  socket.io.on("reconnect_attempt", () => {
    console.log('再接続試行: ' + Date());
  });

  // 試行の失敗
  socket.io.on("reconnect_error", () => {
    console.log('試行失敗: ' + Date());
  });

  // 指定数の再接続に失敗したときの処理
  socket.io.on('reconnect_failed', function() {
    alert('サーバへ接続できません');
    socket = null;
    resetUI();
  }); 
};

// (6) メッセージ送信処理
const sendMessage = () => {
  socket.emit('chat message', {
    type: 'message',
    data: document.getElementById('fromClient').value,
  });
  document.getElementById('fromClient').value = '';
};

// Enterキーでメッセージ送信
document.getElementById('fromClient').addEventListener('change', sendMessage);

// (7) タイピング送信処理
const sendTyping = () => {
  socket.emit('typing');
};

// キーボードタイピング中は typing イベント送信
document.getElementById('fromClient').addEventListener('keydown', sendTyping);

// (1) 入退室処理
const enterLeaveRoom = () => {
  if (socket && !socket.disconnected) {
    socket.close();
    socket = null;
    resetUI();
  }
  else {
    roomName = document.getElementById('roomName').value;
    document.getElementById('roomName').disabled = true;
    document.getElementById('enterLeaveButton').innerText = '退室';
    connect();
  }
};

// 入室・退室ボタン
document.getElementById('enterLeaveButton').addEventListener('click', enterLeaveRoom);
