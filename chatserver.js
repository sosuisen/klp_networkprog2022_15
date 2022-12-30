const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const session = require('express-session');

const host = 'localhost';
const port = 8080;

// 実際のサービスでは、パスワードは bcrypt モジュールでハッシュ化する必要があります
const auth = {
  'kcg1': 'pass1',
  'kcg2': 'pass2',
  'kcg3': 'pass3',
};

const app = express();

// ExpressとSocket.ioを同じポートで動作させる場合、
// http.createServerにappを渡して
// 生成されたhttp.Serverオブジェクトでlistenすること。
// app.listenは使いません
var server = http.createServer(app);
server.listen({ host, port }, () => {
  console.log(`Starting Express and Socket.io (websocket) server at http://${host}:${port}/`)
});

/**
 * Express
 */
// テンプレートエンジンを ejs に設定
app.set('view engine', 'ejs');
// テンプレートが置かれるディレクトリを設定。
// （なお、設定しなくてもデフォルトは ./views です）
app.set('views', './views');

// static以下のファイルを返す
app.use(express.static('static'));

// form で POST された内容を読み取り
app.use(express.urlencoded({extended: true})); //Parse URL-encoded bodies

// session を使えるようにする
const sessionMiddleware = session({
  secret: 'klA1ly7Fry?q',  // セキュリティのため推測できない値を設定
  resave: false,
  saveUninitialized: true,
});
app.use(sessionMiddleware);

app.get('/', (req, res) => {
  // テンプレートファイル ./views/index.ejs 元にHTMLを生成
  res.render('index', { userName: req.session.username });
});

// login へ GET の場合
app.get('/login', (req, res) => {
  if (req.session.username) {
    // ログイン済みであれば /chat へリダイレクト
    res.redirect('/chat');
  }
  else {
    // テンプレートファイル ./views/login.ejs 元にHTMLを生成  
    res.render('login');
  }
});

// login へ POST の場合
app.post('/login', (req, res) => {
  const username = req.body.username;
  const password = req.body.password;
  if (auth[username] === password) {
    req.session.regenerate((err) => {
      req.session.username = username;
      res.redirect('/chat');
    });
  } else {
    res.redirect('/login');
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    res.redirect('/');
  });
});

// トップページ（/）以外のURLでログインしていない場合は
// ログインページへリダイレクト
app.use((req, res, next) => {
  if (req.session.username) {
    next();
  } else {
    res.redirect('/login');
  }
});

app.get('/chat', (req, res) => {
  // テンプレートファイル ./views/chat.ejs 元にHTMLを生成
  res.render('chat', { userName: req.session.username });
});

/**
 * WebSocket
 */

const io = new Server(server);

// Expressのセッションミドルウェアを Socket.IO にセット
io.use((socket, next) => sessionMiddleware(socket.request, {}, next));

// ログイン済みのユーザのみWebSocket接続できる
io.use((socket, next) => {
  const session = socket.request.session;
  if (session && session.username) {
    next();
  } else {
    next(new Error("unauthorized"));
  }
});

const rooms = {};
io.on('connection', socket => {
  // （１）入室時の処理
  const ip = socket.handshake.address;
  // 1-1) 入室したユーザの名前を取得
  const userName = socket.handshake.query.userName;
  if (userName === undefined || userName === "") {
    console.log('Disconnected: User name not found.');
    socket.disconnect(true);
    return;
  }
  // roomName が undefined や '' のときは main
  // 部屋の移動時に変更があるため、const ではなく let にする。
  let roomName = socket.handshake.query.roomName || 'main';

  // roonName へ入室
  socket.join(roomName);

  // ルームへメンバーを追加
  // 同じ名前のユーザが接続してきた場合には未対応
  if (!rooms[roomName]) {
    rooms[roomName] = {};
    // ルームのメンバーを格納するオブジェクト
    rooms[roomName].members = {};
    // ルームのログを格納する配列
    rooms[roomName].log = [];
  }
  rooms[roomName].members[userName] = socket;

  // 過去ログを送信
  socket.emit('log', rooms[roomName].log);

  console.log(`[WebSocket] connected from [${roomName}] ${userName} (${ip})`);
  // 1-2) 全ての入室中のクライアントへ通知
  const mes = {
    type: 'enter',
    name: userName,
    roomName,
  };
  io.to(roomName).emit('chat message', mes);
  // ログに追加
  rooms[roomName].log.push(mes);

  // (2) メッセージ受信時の処理を追加
  socket.on('chat message', req => {
    console.log('[WebSocket] message from client: ' + JSON.stringify(req));

    // メッセージに roomName を加える
    req.roomName = roomName;

    // 誰宛のメッセージか確認
    let messageTo = '';
    // 念のため日本語の空白文字も加えておく（なくてもよい）
    const msgArr = req.data.split(/[ 　]/);
    if (msgArr.length >= 2) {
      messageTo = msgArr[0].slice(1); // 先頭の@を削除
      if (messageTo === 'bot') {
        req.name = 'bot';
        if (msgArr[1] === 'date') {
          req.data = Date();
        }
        else if (msgArr[1] === 'list') {
          req.data = '現在の入室者は ' + Object.keys(rooms[roomName].members).join(', ');
        }
        else if (msgArr[1] === 'join') {
          if (msgArr.length >= 3) {
            // 現在の部屋から退出
            socket.leave(roomName);
            let mes = {
              type: 'leave',
              name: userName,
              roomName,
            };
            io.to(roomName).emit('chat message', mes);
            // ログに追加
            rooms[roomName].log.push(mes);

            // rooms から削除
            delete rooms[roomName].members[userName];

            // 指定の部屋へ入室
            roomName = msgArr[2];
            console.log(`${userName} join to ${roomName}`);
            // 存在しない部屋が指定された場合は作成
            if (!rooms[roomName]) {
              rooms[roomName] = {};
              // ルームのメンバーを格納するオブジェクト
              rooms[roomName].members = {};
              // ルームのログを格納する配列
              rooms[roomName].log = [];
            }
            rooms[roomName].members[userName] = socket;
            socket.join(roomName);

            mes = {
              type: 'enter',
              name: userName,
              roomName,
            };
            io.to(roomName).emit('chat message', mes);
            // ログに追加
            rooms[roomName].log.push(mes);
            return;
          }
        }
        else {
          return;
        }
        // 送信元のクライアントにのみ返信
        socket.emit('chat message', req);

        // bot の場合はここで終わり。
        return;
      }
    }

    // bot宛でないメッセージの場合
    // 送信元のuserNameをnameプロパティを追加
    req.name = userName;

    if (messageTo) {
      if (rooms[roomName].members[messageTo]) {
        // 自分自身と指定クライアントへのみ転送
        socket.emit('chat message', req);
        rooms[roomName].members[messageTo].emit('chat message', req);
      }
      else {
        req.name = 'bot';
        req.data = `${messageTo}さんはいません`;
        socket.emit('chat message', req);
      }
    }
    else {
      // 全ての入室中のクライアントへ転送
      io.to(roomName).emit('chat message', req);
      // ログに追加
      rooms[roomName].log.push(req);
    }
  });

  // (3) 退室時の処理を追加
  socket.on('disconnect', () => {
    console.log(`[WebSocket] disconnected from ${userName} (${ip})`);

    // ルームからメンバーを削除
    // 退室したクライアントを除く全ての入室中のクライアントへ送信
    const mes = {
      type: 'leave',
      name: userName,
      roomName,
    };
    socket.to(roomName).emit('chat message', mes);
    // ログに追加
    rooms[roomName].log.push(mes);
    delete rooms[roomName].members[userName];
  });

  // (4) タイピング中というイベントを処理
  socket.on('typing', () => {
    // イベントを通知してきたクライアントを除く全ての入室中のクライアントへ送信
    socket.to(roomName).emit('chat message', {
      type: 'typing',
      name: userName,
      roomName,
    });
  });
});
