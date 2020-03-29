/* Add the modules */
const express = require('express');
const app = express();
const server = require('http').Server(app);
const io = require('socket.io')(server);

let global = []; // Store the whole game state (of every player)
let allTimeglobal = []; // Store the all time ranking (10 best players of all times)
createAllTimeRanking(); // Fill it with nothing
let rooms = [];
let lastEmits = [];
server.listen(3000); // Listen

app.use(express.static('public'))

/* Send the game to the user */
app.get('/', function (req, res) {
    res.render('tetris.ejs', {page:"home"});
});
app.get('/br/', function (req, res) {
  res.render('tetris.ejs', {page:"br"});
});

/* Handle a new connection */
io.on('connection', function (socket) {

    /* When a user connect to the server */
    socket.on('joinRoom', function(pseudo, room) {

        if(rooms[room] == null) {
          rooms[room] = [];
          rooms[room].state = "preparating";
          console.log(pseudo + " created the room " + room);
        }

        if(rooms[room].state === "preparating") {

          socket.emit('yourId', socket.id); // Send its ID to the player
          socket.emit('okToPlay', true); // The player can enter the room

          socket.join(room);

          socket.pseudo = pseudo;
          socket.room = room;

          rooms[socket.room].push({
            id: socket.id,
            pseudo: socket.pseudo,
            ready: false
          });

          console.log(socket.pseudo + " joined room " + socket.room);

          socket.in(socket.room).emit('roomPlayers', rooms[socket.room], socket.room);
          socket.emit('roomPlayers', rooms[socket.room], socket.room);
        }

        else socket.emit('okToPlay', false); // The room is occupied
    });

    socket.on('imReady', function() {

      if(typeof(rooms[socket.room]) !== 'undefined') {

        let startG = true;
        for(let i = 0; i < rooms[socket.room].length; i++) {
          if(rooms[socket.room][i].id === socket.id) { // Find the player
            rooms[socket.room][i].ready = !rooms[socket.room][i].ready; // Change its state
            if(rooms[socket.room][i].ready) console.log(rooms[socket.room][i].pseudo + " is ready.");
            else console.log(rooms[socket.room][i].pseudo + " is not ready anymore.");
          }
          if(!rooms[socket.room][i].ready) startG = false; // Is everyone is ready, start
        }

        /* Send the room to everyone */
        socket.emit('roomPlayers', rooms[socket.room], socket.room);
        socket.in(socket.room).emit('roomPlayers', rooms[socket.room], socket.room);
        console.log("Rooms updated for the players !");

        if(startG) {

          console.log("Everyone is ready !");

          /* Initiate and send the ranking to everyone */
          global[socket.room] = [];
          socket.emit('classement', global[socket.room]);
          socket.in(socket.room).emit('classement', global[socket.room]);
          console.log("Empty global sent !");

          /* Make everyone start the game */
          socket.emit('startNow');
          socket.in(socket.room).emit('startNow');
          console.log("Start signal sent !");

          let lengthBefore = lastEmits.length;
          for(let i = 0; i < rooms[socket.room].length; i++) {

            global[socket.room].push(new Player(
              rooms[socket.room][i].id,
              rooms[socket.room][i].pseudo,
              0,
              []
            )); // Add the new player to the global state

            lastEmits[lengthBefore + i] = {
              id: rooms[socket.room][i].id,
              room: socket.room,
              pseudo: rooms[socket.room][i].pseudo,
              time: (new Date()).getTime()
            }; // Initiate the last emit
          }

          console.log("Everyone added to global and lastEmits !");

          rooms[socket.room].state = "playing"; // Update the room state

          console.log("Room " + socket.room + " is now playing.");
        }
      }
      else {
        console.log("Room not recognized !" +
          "\n Room : " + socket.room +
          "\n Player : " + socket.pseudo
        );
        socket.emit('message', 'There was a problem, please refresh the game.');
      }
    });

    socket.on('score', function(score, board) {

        let indexplayer; // Index of the player in the global state
        if(typeof(global[socket.room]) !== 'undefined') {
          for (let i = 0; i < global[socket.room].length; i++) {
              if (global[socket.room][i].id === socket.id) {
                  indexplayer = i; // Find the player's index
                  break;
              }
          }

          let indexLastEmit; // Index of the player in the lastEmit array
          for (let i = 0; i < lastEmits.length; i++) {
              if (lastEmits[i].id === socket.id) {
                  indexLastEmit = i; // Find the player's index
                  break;
              }
          }

          /* Update the global state with the infos sent by the user */
          socket.score = score;
          global[socket.room][indexplayer].score = socket.score;
          global[socket.room][indexplayer].board = board;
          lastEmits[indexLastEmit].time = (new Date()).getTime(); // Update the last time the player was seen

          orderGlobal(socket.room); // Rank the players

          /* Send the global ranking to everyone */
          socket.emit('classement', global[socket.room]);
          socket.in(socket.room).emit('classement', global[socket.room]);

          /* Look out for AFKs and KILL THEM */
          let now = (new Date()).getTime();

          for(let i = 0; i < lastEmits.length; i++) {
            if(now - lastEmits[i].time > 60000) { // 1 min

              console.log("A player is AFK.");
              let afkPlayer = lastEmits[i];

              let indexplayer; // Index of the player in the global state
              for (let j = 0; j < global[lastEmits[i].room].length; j++) {
                  if (global[afkPlayer.room][j].id === afkPlayer.id) {
                      indexplayer = j;
                      break;
                  }
              }

              /* Say to everyone that someone is AFK. That someone will recognize himself and stop to play */
              socket.emit('died', global[afkPlayer.room][indexplayer].id);
              socket.in(lastEmits[i].room).emit('died', global[afkPlayer.room][indexplayer].id);

              console.log(
                global[afkPlayer.room][indexplayer].pseudo +
                " was kicked due to AFKness with " +
                global[afkPlayer.room][indexplayer].score +
                " points."
              );

              global[afkPlayer.room].splice(indexplayer, 1);
              lastEmits.splice(i, 1);

              console.log("There's now " + global[afkPlayer.room].length + " players in room " + socket.room);

              if(global[afkPlayer.room].length < 1) {
                delete rooms[afkPlayer.room];
                delete global[afkPlayer.room];
                console.log("Room and global deleted.");
                socket.in(afkPlayer.room).in("spectator").emit('stopSpectate');
              }
              break;
            }
          }
        }
        else {
          console.log("[SCORE] Player not recognized !" +
            "\nRoom : " + socket.room +
            "\nPseudo : " + socket.pseudo +
            "\nID : " + socket.id +
            "\nScore : " + socket.score
          );
          console.log(global);
          socket.emit('message', 'There was a problem, please refresh the game.');
        }
      });

    socket.on('lost', function() {
        if(typeof(global[socket.room]) !== 'undefined') {
          for(let i = 0; i < global[socket.room].length; i++) {
            if(global[socket.room][i].id === socket.id) {
               console.log(global[socket.room][i].pseudo + " lost with " + global[socket.room][i].score + " points.");

               /* Delete in lastEmit */
               let indexLastEmit; // Index of the player in the lastEmit array
               for (let i = 0; i < lastEmits.length; i++) {
                   if (lastEmits[i].id === socket.id) {
                       indexLastEmit = i;
                       break;
                   }
               }
               lastEmits.splice(indexLastEmit, 1);

               console.log("Player deleted in lastEmits.");

               /* Check if you enter in the allTime Ranking */
               if(global[socket.room][i].score > allTimeglobal[allTimeglobal.length - 1].score) {
                  allTimeglobal[allTimeglobal.length - 1] = {
                    pseudo: global[socket.room][i].pseudo,
                    score: global[socket.room][i].score
                  };
                  console.log("The player entered in the leaderboard with " + global[socket.room][i].score + " points.");
                  orderAllTimeGlobal();
                  console.log("Leaderboard ordered !");
                  socket.emit('death', true);
               }
               else socket.emit('death', false);

               global[socket.room].splice(i, 1);
               console.log("Player deleted from global.");

               break;
            }
          }

          socket.leave(socket.room);
          socket.in(socket.room).emit('classement', global[socket.room]);
          console.log("Ranking updated for the other players.");

          console.log("There's now " + global[socket.room].length + " players in room " + socket.room);

          if(global[socket.room].length < 1) {
            delete rooms[socket.room];
            delete global[socket.room];
            console.log("Room and global deleted.");
            socket.in(socket.room).in("spectator").emit('stopSpectate');
          }
        }
        else {
          console.log("[LOST] Player not recognized !" +
            "\nRoom : " + socket.room +
            "\nPseudo : " + socket.pseudo +
            "\nID : " + socket.id +
            "\nScore : " + socket.score
          );
          console.log(global);
          socket.emit('message', 'There was a problem, please refresh the game.');
        }
    });

    socket.on('NeedAllTimeRanking', function() {
      socket.emit('allTimeRanking4u', allTimeglobal);

      let allRoomNames = Object.keys(rooms);
      let roomsToSend = [];
      for(let i = 0; i < allRoomNames.length; i++) {

        let playerList = [];
        for(let j = 0; j < rooms[allRoomNames[i]].length; j++) {
          playerList.push(rooms[allRoomNames[i]][j].pseudo);
        }

        roomsToSend.push({
          name: allRoomNames[i],
          state: rooms[allRoomNames[i]].state,
          players: playerList
        });
      }
      socket.emit('rooms4u', roomsToSend);
    });

    socket.on('spectate', function(room) {
      if(rooms[room] == null) socket.emit('message', 'This room doesn\'t exist.');
      else {
        socket.room = room;
        socket.emit('roomPlayers', rooms[socket.room], socket.room);
        socket.join(room);
        socket.join("spectator");
        socket.emit('okToPlay', true);
        if(rooms[socket.room].state === 'playing') {
          socket.emit('classement', global[socket.room]);
          socket.emit('startNow');
        }
      }
    })
});

/* Define what a player is */
class Player {
  constructor(id, pseudo, score, board) {
    this.id = id;
    this.pseudo = pseudo;
    this.score = score;
    this.board = board;
  }
}

/* Functions */

/* Initiate the allTime Ranking */
function createAllTimeRanking() {
  for(let i = 0; i < 10; i++) {
    allTimeglobal[i] = {pseudo: "---", score: 0};
  }
}

/* Orders the global game */
function orderGlobal(room) {
  for (let i = 0; i < global[room].length; i++)
      for (let j = 0; j < global[room].length; j++)
          if (global[room][j].score < global[room][i].score)
              [global[room][i], global[room][j]] = [global[room][j], global[room][i]];
}

/* Orders the allTimeGlobal */
function orderAllTimeGlobal() {
  for (let i = 0; i < allTimeglobal.length; i++)
      for (let j = 0; j < allTimeglobal.length; j++)
          if (allTimeglobal[j].score < allTimeglobal[i].score)
              [allTimeglobal[i], allTimeglobal[j]] = [allTimeglobal[j], allTimeglobal[i]];
}
