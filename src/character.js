
/*
* Characters.js controls everything dealing with a 'Character' which includes in game creatures.
* No in game commands are defiend here; Commands.js does share some function names with this module, 
* see: save().
*/
'use strict';
var fs = require('fs'),
crypto = require('crypto'),
Room = require('./rooms').room,
Dice = require('./dice').roller,
World = require('./world').world,
Character = function () {

};

Character.prototype.login = function(r, s, fn) {
	var name = r.msg.replace(/_.*/,'').toLowerCase();
	
	if (r.msg.length > 2) {
		if  (/^[a-z]+$/g.test(r.msg) === true && /[`~@#$%^&*()-+={}[]|]+$/g.test(r.msg) === false) {
			fs.stat('./players/' + name + '.json', function (err, stat) {
				if (err === null) {
					return fn(name, s, true);
				} else {
					return fn(name, s, false);
				}
			});
		} else {
			return s.emit('msg', {msg : '<b>Invalid Entry</b>. Enter your name:', res: 'login', styleClass: 'enter-name'});
		}
	} else {
		s.emit('msg', {
			msg: 'Invalid name choice, must be more than two characters.',
			res: 'login',
			styleClass: 'error'
		});
	}
};

Character.prototype.load = function(name, s, fn) {
	fs.readFile('./players/'  + name + '.json', function (err, r) {
		if (err) {
			throw err;
		}
		
		s.player = JSON.parse(r);

		s.player.name = s.player.name.charAt(0).toUpperCase() + s.player.name.slice(1);

		if (s.player.lastname !== '') {
			s.player.lastname = s.player.lastname = s.player.lastname.charAt(0).toUpperCase() + s.player.lastname.slice(1);
		}

		s.player.sid = s.id;
		
		return fn(s);
	});
};

Character.prototype.hashPassword = function(salt, password, iterations, fn) {
	var hash = password,
	i = 0;
		
	for (i; i < iterations; i += 1) {
		hash = crypto.createHmac('sha512', salt).update(hash).digest('hex');
	} 
			
	return fn(hash);
};

Character.prototype.generateSalt = function(fn) {
	crypto.randomBytes(128, function(ex, buf) {
		if (ex) {
			throw ex;
		}
			
		fn(buf.toString('hex'));
	});
};

Character.prototype.getPassword = function(s, fn) {
	var character = this;
	s.emit('msg', {msg: 'What is your password: ', res: 'enterPassword'});

	s.on('password', function (r) {
		if (r.msg.length > 7) {
			character.hashPassword(s.player.salt, r.msg, 1000, function(hash) {
				if (s.player.password === hash) {
					character.addPlayer(s, function(added, msg) {
						if (added) {
								World.motd(s, function() {
									Room.getDisplay(s.player.area, s.player.roomid, function(displayHTML, roomObj) {
										World.msgPlayer(s, {
											msg: displayHTML,
											styleClass: 'room'
										}, function() {
											fn(s);
										});
									});
								});
						} else {
							if (msg === undefined) {
								s.emit('msg', {msg: 'Error logging in, please retry.'});
								return s.disconnect();
							} else {
								s.emit('msg', {msg: msg});
								s.emit('msg', {msg : 'Enter your name:', res: 'login', styleClass: 'enter-name'});
							}
						}
					});
				} else {
					s.emit('msg', {msg: 'Wrong! You are flagged after 5 incorrect responses.', res: 'enterPassword'});
					return s.emit('msg', {msg: 'What is your password: ', res: 'enterPassword'});
				}
			});
		} else {
			s.emit('msg', {msg: 'Password has to be over eight characters.', res: 'enterPassword'});
			return s.emit('msg', {msg: 'What is your password: ', res: 'enterPassword'});
		}
	});
};

// Add a player reference object to the players array
Character.prototype.addPlayer = function(s, fn) {
	var  i = 0;	

	for (i; i < World.players.length; i += 1) {
		if (s.player.name === World.players[i].name) {
			return fn(false, 'Already Logged in. Disconnecting...Refresh the page and relog.');
		}
	}
	
	World.players.push({
		name: s.player.name, 
		sid: s.id,
		area: s.player.area,
		roomid: s.player.roomid
	});

	return fn(true);
};

//  A New Character is saved
Character.prototype.create = function(r, s, fn) { 
	var character = this;

	s.player.displayName = s.player.name[0].toUpperCase() + s.player.name.slice(1);
	s.player.hp += 100;
	s.player.chp += 100;
	s.player.mana += 100;
	s.player.cmana += 100;
	s.player.mv += 100;
	s.player.cmv += 100;
	s.player.isPlayer = true;
	s.player.salt = '';
	s.player.created = new Date();
	s.player.saved = null;
	s.player.role = 'player';
	s.player.area = "Midgaard";
	s.player.roomid = 1;
	s.player.trains += 25;
	s.player.settings = {
		autosac: false,
		autoloot: true,
		autodrink: {enabled: true, itemId: ''},
		wimpy: {enabled: false, hp: 0},
		channels: {
			blocked: ['flame']
		}
	};

	character.rollStats(s.player, function(player) {
		s.player = player;
	
		character.generateSalt(function(salt) {
			s.player.salt = salt;
			character.hashPassword(salt, s.player.password, 1000, function(hash) {
				s.player.password = hash;

				fs.writeFile('./players/' + s.player.name + '.json', JSON.stringify(s.player, null, 4), function (err) {
					var i = 0;
		
					if (err) {
						throw err;
					}

					s.player.saved = new Date();

					character.addPlayer(s, function(added) {
						if (added) {
							s.leave('creation'); // No longer creating the character so leave the channel and join the game
							s.join('mud');

							World.motd(s, function() {
								Room.getDisplay(s.player.area, s.player.roomid, function(displayHTML, roomObj) {
									World.msgPlayer(s, {
										msg: displayHTML, 
										styleClass: 'room'
									});

									fn(s);
								});
							});
						
						} else {
							s.emit('msg', {msg: 'Error logging in, please retry.'});
							s.disconnect();
						}
					});
				});
			});
		});
	});
};

// Rolling stats for a new character
Character.prototype.rollStats = function(player, fn) { 
	var i = 0,
	j = 0,
	raceKey, // property of the race defines in raceList
	classKey; // property of the class defines in classList


	// TODO: abstract these abilities

	for (i; i < World.races.length; i += 1) {// looking for race
		if (World.races[i].name.toLowerCase() === player.race) { // found race		
			for (raceKey in player) {
				if (player[raceKey] in World.races[i] && raceKey !== 'name') { // found, add in stat bonus						
						player[player[raceKey]] = player[player[raceKey]] + World.races[i][player[raceKey]];	
				}
			}
		}
	}

	for (j; j < World.classes.length; j += 1) { // looking through classes
		if (World.classes[j].name.toLowerCase() === player.charClass) { // class match found
			for (classKey in player) {
				if (classKey in World.classes[j] && classKey !== 'name') {
					if (!World.classes[j][classKey].length) {
						player[classKey] = World.classes[j][classKey] + player[classKey];
					} else {
						player[classKey].push(World.classes[j][classKey]);
					}
				} 
			}
		}
	}
			
	player.carry = player.str * 10;

	return fn(player);
};

Character.prototype.newCharacter = function(r, s, fn) {
	var character = this,
	i = 0,
	str = '';

	World.getPlayableRaces(function(races) {
		World.getPlayableClasses(function(classes) {
			for (i; i < races.length; i += 1) {
				str += '<li class="race-list-'+ races[i].name + '">' + races[i].name + '</li>';

				if	(races.length - 1 === i) {
					s.emit('msg', {msg: s.player.name + ' is a new character! There are three more steps until ' + s.player.name + 
					' is saved. The next step is to select your race: <ul>' + str + '</ul><p class="tip">You can learn more about each race by typing help race name</p>', res: 'selectRace', styleClass: 'race-selection'});		

					s.on('raceSelection', function (r) { 
						var cmdArr = r.msg.split(' ');

						r.cmd = cmdArr[0].toLowerCase();
						r.msg = cmdArr.slice(1).join(' ');
			
						character.raceSelection(r, s, function(r, s, fnd) {
							if (fnd) {
								i = 0;
								str = '';
								s.player.race = r.cmd;

								for (i; i < classes.length; i += 1) {
									str += '<li>' + classes[i].name + '</li>';

									if	(classes.length - 1 === i) {
										s.emit('msg', {
											msg: 'Great, two more steps to go! Now time to select a class for ' + s.player.name + '. Pick one of the following: <ul>' + 
											str + '</ul>', 
											res: 'selectClass', 
											styleClass: 'race-selection'
										});
										
										s.on('classSelection', function(r) {
											r.msg = r.msg.toLowerCase();

											character.classSelection(r, function(fnd) {
												if (fnd) {
													s.player.charClass = r.msg;
													
													s.emit('msg', {
														msg: s.player.name + ' is a ' + s.player.charClass + '! One more step before ' + s.player.name + 
														' is saved. Please define a password (8 or more characters):', 
														res: 'createPassword', 
														styleClass: 'race-selection'
													});
										
													s.on('setPassword', function(r) {
														if (r.msg.length > 7) {
															s.player.password = r.msg;
															character.create(r, s, fn);
														} else {
															s.emit('msg', {msg: 'Password should be longer', styleClass: 'error' });
														}
													});
												} else {
													s.emit('msg', {msg: 'That class is not on the list, please try again', styleClass: 'error' });
												}
											}); 
										});
									}
								}
							} else if (!fnd && r.cmd !== 'help') {
								s.emit('msg', {msg: 'That race is not on the list, please try again', styleClass: 'error' });
							}
						});
					});
				}
			}
		});
	});
};

Character.prototype.raceSelection = function(r, s, fn) {
	var i = 0,
	helpTxt;

	if (r.cmd !== 'help') {
		World.getPlayableRaces(function(races) {
			for (i; i < races.length; i += 1) {
				if (r.cmd === races[i].name.toLowerCase()) {
					return fn(r, s, true);
				}
			}

			return fn(r, s, false);
		});
	} else {
		fs.readFile('./help/' + r.msg + '.json', function (err, data) {
			if (!err) {
				data = JSON.parse(data);

				helpTxt = '<h2>Race Profile: ' + data.name + '</h2> ' + data.description + 
				'<h3>Benefits:</h3><p class="small">Related: '+ data.related.toString() + '</p>';

				s.emit('msg', {msg: helpTxt, styleClass: 'cmd-help' });

				return fn(r, s, false);
			} else {
				s.emit('msg', {msg: 'No help file found for this race.', styleClass: 'error' });	

				return fn(r, s, false);
			}
		});
	}
};

Character.prototype.classSelection = function(r, fn) {
	var i = 0;

	World.getPlayableClasses(function(classes) {
		for (i; i < classes.length; i += 1) {
			if (r.msg === classes[i].name.toLowerCase()) {
				return fn(true)
			}
		}

		return fn(false);
	});
};

Character.prototype.save = function(s, fn) {
	var character = this;

	if (s.player !== undefined) {
		s.player.modified = new Date().toString();

		fs.writeFile('./players/' + s.player.name.toLowerCase() + '.json', JSON.stringify(s.player, null, 4), function (err) {
			if (err) {
				return World.msgPlayer(s, {msg: 'Error saving character.'});
			} else {
				character.updatePlayer(s.player, function() {
					if (typeof fn === 'function') {
						return fn();
					}
				})
			}
		});
	}
};

Character.prototype.getModifier = function(s, stat, fn) {
	var mod = Math.round(s.player[stat]/3);
	
	if (!fn) {
		return mod;
	} else {
		return fn(mod);
	}
};

Character.prototype.hpRegen = function(s, fn) {
	var conMod = this.getModifier(s, 'con');

	if (s.player.chp < s.player.hp) {
		if (s.player.position === 'sleeping') {
			conMod = conMod + 2;
		}

		Dice.roll(1 * (s.player.level + conMod), 8, function(total) {
			fn(s.player.chp + total);
		});
	} else {
		fn(s.player.chp);
	}
}

Character.prototype.hunger = function(s, fn) {
	var character = this,
	conMod = Math.ceil(s.player.con/3);
	
	if (s.player.hunger < 10) {
		Dice.roll(1, 4, function(total) {
			if ((total + conMod) < s.player.con/2) { 
				s.player.hunger = s.player.hunger + 1;
			}			
						
			if (s.player.hunger >= 5) {	
				if (total < 4) {
					s.player.chp = s.player.chp - (s.player.chp / 5 + conMod);
				}
			
				s.emit('msg', {msg: 'You are hungry.', styleClass: 'hunger'});
		
				fn();
			}
		});
	} else {
		s.player.chp = (s.player.chp - 10 + conMod);
		s.emit('msg', {msg: 'You are dying of hunger.', styleClass: 'hunger'});
		
		fn();
	}
};

Character.prototype.thirst = function(s, fn) {
	var character = this,
	dexMod = Math.ceil(s.player.dex/3);

	if (s.player.thirst < 10) {
		Dice.roll(1, 4, function(total) {
			if (total + dexMod < 5) { 
				s.player.chp = s.player.chp - (s.player.chp / 4 + dexMod);
			}			
						
			if (s.player.thirst >= 5) {
				s.player.chp = s.player.chp - 1;
			}

			s.emit('msg', {msg: 'You need to find something to drink.', styleClass: 'thirst'});

			fn();
		});	
	} else {
		s.player.chp = (s.player.chp - 5 + dexMod);
		s.emit('msg', {msg: 'You are dying of thirst.', styleClass: 'thirst'});
		
		fn();
	}
};

// callback with boolean if item with the supplied string matches inventory item, and first matched item as
// second argument if applicable
Character.prototype.checkInventory = function(r, s, fn) {
	var msgPatt,
	items,
	parts,
	findIndex,
	findItem;

	// Split to account for target modifier (IE: 2.longsword)
	parts = r.msg.split('.');

	if (parts.length === 2) {
		findIndex = parseInt(parts[0]) - 1;
		findItem = parts[1];
	} else {
		findIndex = 0;
		findItem = r.msg;
	}

	msgPatt = new RegExp('^' + findItem);

	items = s.player.items.filter(function(item, i) {
		if (msgPatt.test(item.name.toLowerCase())) {
			return true;
		}
	});

	if (items.length > 0 && findIndex in items) {
		fn(true, items[findIndex]);
	} else {
		fn(false);
	}
};


// push an item into a players inventory, checks items to ensure a player can use it
Character.prototype.addToInventory = function(s, item, fn) {
	s.player.items.push(item);
	
	fn(true);
};

/*
* Returns all items that meet the query criteria, could be optimized if your
* slots are consistent.
*/
Character.prototype.getWeapons = function(creature, fn) {
	var i = 0,
	weapons = [];

	for (i; i < creature.eq.length; i += 1) {	
		if (creature.eq[i].slot === 'hands' && creature.eq[i].item !== null && creature.eq[i].item.itemType === 'weapon') {
			weapons.push(creature.eq[i].item);
		}
	}

	if (weapons.length === 0) {
		weapons.push({
			attackType: creature.attackType,
			itemType: 'fist',
			material: 'flesh',
			weight: 0,
			slot: 'hands',
			diceNum: 2,
			diceSides: 2
		});
	}
	
	if (typeof fn === 'function') {
		return fn(weapons);
	} else {
		return weapons;
	}
};

Character.prototype.removeFromInventory = function(s, itemObj, fn) {
	var i = 0;

	if (s.player.items.length > 0) {
		s.player.items = s.player.items.filter(function(item, i) {
			if (item.id !== itemObj.id) {
				return true;
			}		
		});
	
		if (typeof fn === 'function') {
			return fn(true);
		}	
	} else {
		if (typeof fn === 'function') {
			return fn(false);
		}
	}
};

Character.prototype.wear = function(r, s, item, fn) {
	var i = 0,
	replacedItem;	

	for (i; i < s.player.eq.length; i += 1) {	
		if (item.slot === s.player.eq[i].slot && item.equipped === false) {
			if (item.itemType === 'weapon') {
				 item.equipped = true;
				 
				// Wielding weapons
				if (item.weight < (20 + s.player.str)) { // Dual check

				}

				if (s.player.eq[i].dual === false && s.player.eq[i].item === null) {
					s.player.eq[i].item = item;

					fn(true, 'You wield a ' + item.short + ' in your ' + s.player.eq[i].name);
					break;
				}
			} else {
				// Wearing Armor
				if (s.player.eq[i].item === null) {
					item.equipped = true;
					s.player.eq[i].item = item;

					s.player.ac = s.player.ac + item.ac;
					
					return fn(true, 'You wear a ' + item.short + ' on your ' + s.player.eq[i].name);
				} else {
					item.equipped = true;
					s.player.eq[i].item.equipped = false;

					replacedItem = s.player.eq[i].item;
					s.player.eq[i].item = item;

					s.player.ac = s.player.ac - replacedItem.ac;

					s.player.ac = s.player.ac + item.ac

					return fn(true, 'You wear ' + item.short + ' on your ' + 
						s.player.eq[i].name + ' and remove ' + 
						replacedItem.short);
				}
			}
		} 
	}
};

Character.prototype.getLoad = function(s) {
	var load = Math.round((s.player.str + s.player.con / 4) * 10);
	
	return load;
};

// Updates a players reference in players[] with some data attached to the socket
Character.prototype.updatePlayer = function(player, fn) {
	var  i = 0;

	for (i; i < World.players.length; i += 1) {
		if (player.name === World.players[i].name) {
			World.players[i] = {
				name: player.name, 
				sid: player.sid,
				area: player.area,
				roomid: player.roomid
			};
			
			if (typeof fn === 'function') {
				fn(true);
			} 
		}
	}
};

Character.prototype.level = function(s, fn) {

};

// Add in gear modifiers and return the updated object
Character.prototype.calculateGear = function() {

};

module.exports.character = new Character();
 
