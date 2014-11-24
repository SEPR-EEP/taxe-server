/**
 * taxe-server
 * Game server for the TAxE Game.
 *
 * EEP Group
 * Software Engineering Project
 * Department of Computer Science
 * University of York
 * https://github.com/SEPR-EEP
 */

// Server configuration
const SERVER_PORT 			= 8042;		// Port for the server to listen for connections
const DEBUG 				= true;		// If set to true, prints out debug information during execution

// Listen on SERVER_PORT for connections
var io = require('socket.io')(SERVER_PORT);

// Initialise data structures
var games = {};		// List to hold all games

// Here follows an example property of the games object
/*{ 
	'2cic89vk7': 	// Property name is game code
		{
			name: 		string,
			difficulty: int,
			players: {
				master: string,
				slave: 	string,
			},
			created: 	Date,
			data: 		Binary,
			sockets: {
				master: Socket,
				slave:  Socket|null
			}
		}
};*/


var colors = require('colors');

/**
 * Prints to screen iff debug mode is enabled
 * @param string message 	The debug message to print
 */
function debugLog(message) {
	if (DEBUG) { console.log(message); }
}

/**
 * Nicely display an event
 * @param prefix 	Prefix (event name)
 * @param socket 	Socket object
 * @param game 		Game ID or NULL
 * @param message 	Message
 */
function socketLog(prefix, socket, game, message) {
	debugLog( 
		(new Date).toLocaleTimeString().red.bold + "\t"
		+ "Client: " 	+ socket.id.substr(0, 8).blue.bold + " (" + socket.request.connection._peername.address.blue.bold + ") " + "\t"
		+ "Game: "		+ (game 					? game 		  : 'None').blue.bold + "\t"
		+ "Role: " 		+ (socket && socket.role 	? socket.role : 'N/A').blue.bold
	);
	debugLog(" " + prefix.green.bold + "\t" + message);
}

debugLog('Setting up server...'.gray);
io.on('connection', function (socket) {

	socketLog("<CONNECT", socket, false, "Player connected");

	/**
	 * Store game information for the current socket/client
	 */
	socket.gameID = null;	// string containing the game ID or null if not in game
	socket.role   = null;	// "master", "slave" or null if not in game

	/**
	 * <- LG: List joinable games
	 * Returns a list of joinable games
	 * @return List 	List of available games 
	 *					[{id: string, name: string, created: Date, difficulty: int}, ...]
	 */
	socket.on('LG', function (respond) {
		
		// Find available games
		var availableGames = [];

		// For each game...
		for ( code in games ) { 

			// If there already is a second player, skip
			if ( games[code].players.slave != null )
				continue;

			// Otherwise, add to the list of available games
			availableGames.push({
				id: 		code,
				name: 		games[code].name,
				created: 	games[code].created,
				difficulty: games[code].difficulty
			});

		}

		// Respond with available games
		respond(availableGames);

		// Debug output
		socketLog("<LG", socket, false, availableGames.length + " joinable games");
		debugLog(availableGames);

	});

	/**
	 * <- CG: Create Game
	 * Create a new game and returns GameID and GameName
	 * @param string playerName		The Name of the Master Player
	 * @param int 	 difficulty		The difficulty factor of the game
	 * @param object gameData 		Starting game data {master: Blob(), slave: Blob()}
	 * @return object 				New game's data { id: string, name: string, created: Date }
	 */
	socket.on('CG', function (playerName, difficulty, gameData, respond) {
		
		// Create Random ID
		var gameID;
		do {
			gameID = Math.random().toString(36).substring(2, 7);
		} while ( games.hasOwnProperty(gameID) ); // It must not already exist.

		// Generate game name from player's name
		var gameName = 
			playerName.slice(-1) != 's'	 // Check if last char is s
				? playerName + "'s Game" // Jack's Game
				: playerName + "' Game"; // Lars' Game

		// Push the game to the list
		games[gameID] = {
			name: 			gameName,
			difficulty: 	difficulty,
			players: 	{
				master: 	playerName,
				slave: 		null,
			},
			created: 		new Date(),
			data: 			gameData,
			sockets: 	{
				master: 	socket,
				slave: 		null
			}
		}

		// Store game information in session
		socket.gameID 	= gameID;
		socket.role  	= 'master';

		// Respond with the new game data
		respond({
			id: 		gameID,
			name: 		gameName,
			created: 	new Date(),
			difficulty: difficulty
		});

		socketLog("<CG", socket, gameID, "Created new Game");
		debugLog(games[gameID]);

	});


	/**
	 * <- JG: Join Game
	 * Join a Game and start playing!
	 * @param string gameID 		The ID of the Game to Join
	 * @param string playerName		The Name of the player who joins the game (slave)
	 * @return object 				Status. If error (ok=false), an error message is returned
	 *								{ ok: bool, <error: string> }
	 */
	socket.on('JG', function (gameID, playerName, respond) {

		// Check if the game exists
		if ( !games.hasOwnProperty(gameID) ) {
			respond({
				ok: 	false,
				error: 	"Sorry, the Game could not be found."
			});
			socketLog("<JG", socket, gameID, "Error, game not found");
			return;
		}

		// Check if there is a nickname collision
		if ( games[gameID].players.master == playerName ) {
			respond({
				ok: 	false,
				error: 	"Sorry, you cannot use the same nickname as your opponent."
			});
			socketLog("<JG", socket, gameID, "Error, nickname already in use");
			return;
		}
		
		// Okay, join the game
		games[gameID].players.slave = playerName;	// Set second player's name
		games[gameID].sockets.slave = socket;		// Set second player's socket

		// Store game information in session
		socket.gameID 	= gameID;
		socket.role  	= 'slave';

		// Yes, you joined the game
		respond({
			ok: true
		});
		socketLog("<JG", socket, gameID, "Player joined the Game");


		// Tell the master player that the Game started
		games[gameID].sockets.master.emit('GS');
		socketLog(">GS", games[gameID].sockets.master, gameID, "The Game has started");

		// And ask the slave player to play the first move
		games[gameID].sockets.slave.emit('PP', games[gameID].data);
		socketLog(">PP", games[gameID].sockets.slave, gameID, "Please play your turn");

	});


	/**
	 * <- M: Move (Slave Player turn)
	 * @param Binary gameData 		The Game Data
	 * @return object 				Status. If error (ok=false), an error message is returned
	 *								{ ok: bool, <error: string> }
	 */
	socket.on('M', function (gameData, respond) {

		// If you're not a slave player, you should not be here
		if ( socket.role != 'slave' ) {
			respond({
				ok: 	false,
				error: 	"Sorry, you are the master player or you have not joined a game."
			});
			socketLog("<M", socket, socket.gameID, "You are not allowed to move");
			return;
		}

		// Store the updated game data
		var gameID = socket.gameID;
		games[gameID].data = gameData;

		// Thanks for your move
		respond({
			ok: true
		});
		socketLog("<M", socket, gameID, "Received move data");

		// Now ask the master to play its turn, with the new data
		games[gameID].sockets.master.emit('PP', games[gameID].data);
		socketLog(">PP", games[gameID].sockets.master, gameID, "Please play your turn");

	});

	/**
	 * <- ET: End Turn (Master Player turn)
	 * @param Binary gameData 		The Game Data
	 * @return object 				Status. If error (ok=false), an error message is returned
	 *								{ ok: bool, <error: string> }
	 */
	socket.on('ET', function (gameData, respond) {

		// If you're not a slave player, you should not be here
		if ( socket.role != 'master' ) {
			respond({
				ok: 	false,
				error: 	"Sorry, you are the slave player or you have not joined a game."
			});

			socketLog("<ET", socket, socket.gameID, "You are not allowed to end turn");
			return;
		}

		// Store the updated game data
		var gameID = socket.gameID;
		games[gameID].data = gameData;

		// Thanks for your move
		respond({
			ok: true
		});
		socketLog("<ET", socket, gameID, "Received end of turn data");

		// Now ask the master to play its turn, with the new data
		games[gameID].sockets.slave.emit('PP', games[gameID].data);
		socketLog(">PP", games[gameID].sockets.slave, gameID, "Please play your turn");

	});


	/**
	 * <- DISCONNECT
	 * This event is triggered when a client disconnects.
	 */
	socket.on('disconnect', function () {

		socketLog("<DISCONNECT", socket, socket.gameID, "Player has disconnected");

		// If the player wasn't playing, nothing to do
		if ( !socket.gameID ) { return; }

		// Otherwise, I need to inform the other player
		var gameID 	 = socket.gameID;
		var opponent = null;

		// Inform the other player that the game has ended
		// and remove its session data (allow to join other games)
		if ( socket.role == 'master' )
			opponent = games[gameID].sockets.slave;
		else 
			opponent = games[gameID].sockets.master;
		
		if ( opponent != null ) {
			opponent.emit('EG');
			opponent.gameID = null;
			opponent.role 	= null;
			socketLog(">EG", opponent, socket.gameID, "Notified opponent of end of game");
		}

		// Finally, it's time to delete the game from here
		delete games[gameID];
		socketLog("<DISCONNECT", socket, gameID, "Deleted game");

	});

});

debugLog(("This Server is now listening for connections on port " + SERVER_PORT).gray.bold);
