import {
    world,
    system,
    Player,
    Entity,
    PlatformType,
    TicksPerSecond,
    BlockVolume,
    Dimension,
    GameMode, HudVisibility, HudElement, EntityInitializationCause, EntityComponentTypes
} from "@minecraft/server";

const admins = [
    "BioTomateDE",
    "HeiligTomate",
    "latuskati",
    "Tomatigga"
]

const playerNameCharset = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 ()".split("");


function isValid(value) {
    if (value === undefined || typeof value === 'undefined') return false;
    if (value === null) return false;
    if (typeof value === 'number' && (isNaN(value) || !isFinite(value))) return false;
    return true;
}


function isValidPlayer(entity) {
    if (!isValid(entity)) return false;
    if (entity.typeId !== "minecraft:player") return false;
    if (!entity.isValid()) return false;
    return true;
}


function commandifyPlayerName(nameRaw) {
    if (!nameRaw.split("").every(ch => playerNameCharset.includes(ch))) {
        return null;
    }
    if (nameRaw.split("").some(ch => ch === ' ')) {
        return ' ' + nameRaw + ' ';
    }
    return nameRaw;
}


function isPointInsideVolume(volume, point) {
    if (point.x < volume.from.x) return false;
    if (point.y < volume.from.y) return false;
    if (point.z < volume.from.z) return false;

    if (point.x > volume.to.x) return false;
    if (point.y > volume.to.y) return false;
    if (point.z > volume.to.z) return false;

    return true;
}


function getObjective(objectiveName, creationDisplayName = null) {
    let objective = world.scoreboard.getObjective(objectiveName);
    if (isValid(objective)) {
        return objective;
    }
    world.sendMessage(`[§gWARN§r] Creating objective "${objectiveName}" since it didn't exist!`);
    let objectiveDisplayName = objectiveName;
    if (creationDisplayName !== null) {
        objectiveDisplayName = creationDisplayName;
    }
    return world.scoreboard.addObjective(objectiveName, objectiveDisplayName);
}


function getScore(objective, player) {
    let score = objective.getScore(player);
    if (!isValid(score)) {
        score = 0;
    }
    return score;
}


function getPlayerByID(playerID) {
    // Find a player with the matching ID in the world
    // If player is not found, return null.
    const allPlayers = world.getAllPlayers();
    const playersFiltered = allPlayers.filter(player => player.id === playerID);
    if (playersFiltered.length === 0) {
        return null;
    }
    return playersFiltered[0];
}


// useful for debugging without spamming everyone in the server
function log(...args) {
    let players = world.getAllPlayers().filter(player => admins.includes(player.name));
    players.forEach(player => player.sendMessage(args.join(" ")));
}


function sendSubtitle(message, fadeIn, stay, fadeOut, players = null) {
    if (players === null) {
        players = world.getAllPlayers();
    }

    players.forEach(player => {
        player.onScreenDisplay.setTitle("§§", {
            subtitle: message,
            fadeInDuration: fadeIn,
            stayDuration: stay,
            fadeOutDuration: fadeOut
        });
    });
}


function moveToSpawn(player) {
    player.runCommand("clear @s");
    player.runCommand("effect @s clear");
    player.runCommand("tp @s 10000 -39 10000 -90 0");
    player.runCommand("inputpermission set @s jump enabled");
}


function getKD(player, options = {}) {
    let scoreboardKills = options['scoreboardKills'];
    let scoreboardDeaths = options['scoreboardDeaths'];
    let kills = options['kills'];
    let deaths = options['deaths'];

    if (!isValid(kills)) {
        if (!isValid(scoreboardKills)) {
            scoreboardKills = getObjective("kills");
        }
        kills = getScore(scoreboardKills, player);
    }

    if (!isValid(deaths)) {
        if (!isValid(scoreboardDeaths)) {
            scoreboardDeaths = getObjective("deaths");
        }
        deaths = getScore(scoreboardDeaths, player);
    }

    deaths = deaths === 0 ? 1 : deaths;    // prevent zero division
    let kdRatio = kills / deaths;
    return kdRatio;
}


function showKillstreakMessage(player, killstreak) {
    const pluralSuffix = killstreak >= 2 ? "s" : "";

    if (killstreak % 5 === 0) {
        sendSubtitle(`\n\n\n§b${killstreak}§s Kill${pluralSuffix}!`, 0, 35, 7, [player]);
    } else {
        sendSubtitle(`\n\n\n§e${killstreak}§g Kill${pluralSuffix}!`, 0, 15, 2, [player]);
    }

    if (killstreak % 10 === 0) {
        world.sendMessage(`§5${player.name}§d is on a killing spree!`);
    }
}


function generateCuboids(W, H, D, C) {
    const cuboids = [];

    function splitCuboid(x, y, z, width, height, depth) {
        const volume = width * height * depth;

        // Base Case: If the volume is within the limit, add cuboid
        if (volume <= C) {
            cuboids.push({x, y, z, width, height, depth});
            return;
        }

        // Find the longest dimension to split
        if (width >= height && width >= depth) {
            // Split along width
            let maxW = Math.min(width, Math.floor(C / (height * depth)));
            if (maxW === 0) maxW = 1; // Ensure progress
            splitCuboid(x, y, z, maxW, height, depth);
            splitCuboid(x + maxW, y, z, width - maxW, height, depth);
        } else if (height >= width && height >= depth) {
            // Split along height
            let maxH = Math.min(height, Math.floor(C / (width * depth)));
            if (maxH === 0) maxH = 1;
            splitCuboid(x, y, z, width, maxH, depth);
            splitCuboid(x, y + maxH, z, width, height - maxH, depth);
        } else {
            // Split along depth
            let maxD = Math.min(depth, Math.floor(C / (width * height)));
            if (maxD === 0) maxD = 1;
            splitCuboid(x, y, z, width, height, maxD);
            splitCuboid(x, y, z + maxD, width, height, depth - maxD);
        }
    }

    // Start with the full cuboid at origin (0, 0, 0)
    splitCuboid(0, 0, 0, W, H, D);
    return cuboids;
}


function fillBlocks(dimension, from, to, block, options = {}) {
    // Fills blocks while bypassing the 32768 block limit

    const normalizedVolume = {
        x: 1 + to.x - from.x,
        y: 1 + to.y - from.y,
        z: 1 + to.z - from.z
    };

    const normalizedCuboids = generateCuboids(normalizedVolume.x, normalizedVolume.y, normalizedVolume.z, 32768);
    normalizedCuboids.forEach(normalizedCuboid => {

        const cuboidPositionFrom = {
            x: from.x + normalizedCuboid.x,
            y: from.y + normalizedCuboid.y,
            z: from.z + normalizedCuboid.z
        }

        const cuboidPositionTo = {
            x: cuboidPositionFrom.x + normalizedCuboid.width - 1,
            y: cuboidPositionFrom.y + normalizedCuboid.height - 1,
            z: cuboidPositionFrom.z + normalizedCuboid.depth - 1
        }

        const volume = new BlockVolume(cuboidPositionFrom, cuboidPositionTo);
        dimension.fillBlocks(volume, block, options);
    });
}


function clearArena() {
    world.sendMessage("§aClearing Arena...");

    const groundFrom = {
        x: arenaVolume.from.x + 1,
        y: arenaVolume.from.y,
        z: arenaVolume.from.x + 1
    }
    const groundTo = {
        x: arenaVolume.to.x - 1,
        y: arenaVolume.from.y,
        z: arenaVolume.to.z - 1
    }
    fillBlocks(overworld, groundFrom, groundTo, "minecraft:allow");

    const dirtFrom = {
        x: arenaVolume.from.x + 1,
        y: arenaVolume.from.y + 1,
        z: arenaVolume.from.x + 1
    }
    const dirtTo = {
        x: arenaVolume.to.x - 1,
        y: arenaVolume.from.y + 2,
        z: arenaVolume.to.z - 1
    }
    fillBlocks(overworld, dirtFrom, dirtTo, "minecraft:dirt");

    const grassFrom = {
        x: arenaVolume.from.x + 1,
        y: arenaVolume.from.y + 3,
        z: arenaVolume.from.x + 1
    }
    const grassTo = {
        x: arenaVolume.to.x - 1,
        y: arenaVolume.from.y + 3,
        z: arenaVolume.to.z - 1
    }
    fillBlocks(overworld, grassFrom, grassTo, "minecraft:grass_block");

    const airFrom = {
        x: arenaVolume.from.x + 1,
        y: arenaVolume.from.y + 4,
        z: arenaVolume.from.z + 1
    }
    const airTo = {
        x: arenaVolume.to.x - 1,
        y: arenaVolume.to.y,    // -0 instead of -1 because the waterlogged barries don't get replaced otherwise
        z: arenaVolume.to.z - 1
    }
    fillBlocks(overworld, airFrom, airTo, "minecraft:air");
    // v this does what the fix above SHOULD'VE done, but for some fucking reason it doesn't work otherwise
    fillBlocks(overworld, airFrom, airTo, "minecraft:air");

    const roofFrom = {
        x: arenaVolume.from.x,
        y: arenaVolume.to.y,
        z: arenaVolume.from.z
    }
    const roofTo = {
        x: arenaVolume.to.x,
        y: arenaVolume.to.y,
        z: arenaVolume.to.z
    }
    fillBlocks(overworld, roofFrom, roofTo, "minecraft:barrier");

    const wallX1From = {
        x: arenaVolume.from.x,
        y: arenaVolume.from.y,
        z: arenaVolume.from.z
    };
    const wallX1To = {
        x: arenaVolume.from.x,
        y: arenaVolume.to.y - 1,
        z: arenaVolume.to.z
    };
    fillBlocks(overworld, wallX1From, wallX1To, "minecraft:bedrock");

    const wallX2From = {
        x: arenaVolume.to.x,
        y: arenaVolume.from.y,
        z: arenaVolume.from.z
    };
    const wallX2To = {
        x: arenaVolume.to.x,
        y: arenaVolume.to.y - 1,
        z: arenaVolume.to.z
    };
    fillBlocks(overworld, wallX2From, wallX2To, "minecraft:bedrock");

    const wallZ1From = {
        x: arenaVolume.from.x,
        y: arenaVolume.from.y,
        z: arenaVolume.from.z
    };
    const wallZ1To = {
        x: arenaVolume.to.x,
        y: arenaVolume.to.y - 1,
        z: arenaVolume.from.z
    };
    fillBlocks(overworld, wallZ1From, wallZ1To, "minecraft:bedrock");

    const wallZ2From = {
        x: arenaVolume.from.x,
        y: arenaVolume.from.y,
        z: arenaVolume.to.z
    };
    const wallZ2To = {
        x: arenaVolume.to.x,
        y: arenaVolume.to.y - 1,
        z: arenaVolume.to.z
    };
    fillBlocks(overworld, wallZ2From, wallZ2To, "minecraft:bedrock");

    // extra air on top of the arena
    const airOnRoofFrom = {
        x: arenaVolume.from.x,
        y: arenaVolume.to.y + 1,
        z: arenaVolume.from.z
    }
    const airOnRoofTo = {
        x: arenaVolume.to.x,
        y: arenaVolume.to.y + 6,
        z: arenaVolume.to.z
    }
    fillBlocks(overworld, airOnRoofFrom, airOnRoofTo, "minecraft:air");

    world.sendMessage("§aArena cleared!");
    sendSubtitle("\n\n§aArena cleared!", 3, 28, 21);
}


function findArenaSpawn() {
    const attemptCount = 20;

    for (let i = 0; i < attemptCount; i++) {
        const x = Math.floor(arenaVolume.from.x + Math.random() * (arenaVolume.to.x - arenaVolume.from.x));
        const z = Math.floor(arenaVolume.from.z + Math.random() * (arenaVolume.to.z - arenaVolume.from.z));
        const location = {x: x, y: arenaVolume.from.y + 4, z: z};
        const block = overworld.getBlock(location);
        if (block.isAir) {
            return location;
        }
    }

    // failed to find valid spawn location within `attemptCount` attempts; spawn in center and raise warning
    const warnMessage = `[§eWARN§r] Could not find valid Arena spawn location within ${attemptCount} attempts!`;
    log(warnMessage);
    console.warn(warnMessage);
    return {
        x: arenaVolume.from.x + (arenaVolume.to.x - arenaVolume.from.x) / 2,
        y: arenaVolume.from.y + 4,
        z: arenaVolume.from.z + (arenaVolume.to.z - arenaVolume.from.z) / 2
    }
}


// teleport joined and respawned players into lobby
world.afterEvents.playerSpawn.subscribe(data => {
    moveToSpawn(data.player);

    // Greet joined players
    if (data.initialSpawn) {
        data.player.playSound("random.levelup");
        data.player.onScreenDisplay.setTitle("§gWelcome!", {fadeInDuration: 30, stayDuration: 40, fadeOutDuration: 30});
    }
});


// handle kill, death
world.afterEvents.entityDie.subscribe(data => {
    if (!isValidPlayer(data.deadEntity)) {
        return;
    }

    let scoreboardDeaths = getObjective("deaths");
    let scoreboardKills = getObjective("kills");
    let scoreboardKillstreak = getObjective("killstreak");

    scoreboardDeaths.addScore(data.deadEntity, 1);
    scoreboardKillstreak.setScore(data.deadEntity, 0);

    // Try to find a killer by finding the player who dealt the most damage to the victim
    let attacker;
    let attackersSorted = [];

    if (data.deadEntity.id in playerDamages) {
        attackersSorted = Object.entries(playerDamages[data.deadEntity.id])
            .filter(([attacker, damage]) => damage >= 5)
            .toSorted(([attacker1, damage1], [attacker2, damage2]) => damage1 > damage2 ? -1 : 1);
    }

    if (attackersSorted.length > 0) {
        let attackerID = attackersSorted[0][0];
        attacker = getPlayerByID(attackerID);   // can be null
    }
    else if (isValidPlayer(data.damageSource?.damagingEntity)) {
        attacker = data.damageSource.damagingEntity;
    }

    delete playerDamages[data.deadEntity.id];
    if (!isValid(attacker)) return;

    const attackerIsInArena = attacker.hasTag("arena");
    scoreboardKills.addScore(attacker, 1);
    attacker.playSound("dig.snow", {pitch: 1});
    attacker.playSound("break.amethyst_cluster", {pitch: 1.7});

    if (attackerIsInArena) {
        scoreboardKillstreak.addScore(attacker, 1);
        showKillstreakMessage(attacker, scoreboardKillstreak.getScore(attacker));
        attacker.addEffect("absorption", 600, {amplifier: 0, showParticles: false});
        attacker.addEffect("regeneration", 100, {amplifier: 2, showParticles: true});
        attacker.addEffect("saturation", 20, {amplifier: 0, showParticles: true});
    }
});


// Keep track of player damages to determine who to award the kill if the death is indirect (fall damage, ender pearl damage, lava, fire, burning)
world.afterEvents.entityHurt.subscribe(data => {
    if (!isValidPlayer(data.hurtEntity) || !isValidPlayer(data.damageSource?.damagingEntity)) {
        return;
    }

    const victim = data.hurtEntity;
    const attacker = data.damageSource.damagingEntity;
    const damageAmount = data.damage;

    // if (attacker.id in playersSpawnProtection || 1) {
    //     // https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/entityhealthcomponent?view=minecraft-bedrock-stable
    //     const healthComponent = victim.getComponent(EntityComponentTypes.Health);
    //     const victimHealth = healthComponent.currentValue;
    //     healthComponent.resetToMaxValue();
    //     victim.applyDamage(20 - victimHealth);
    // }

    // Projectile hit confirmation sound
    if (isValid(data.damageSource?.damagingProjectile)) {
        switch (data.damageSource.damagingProjectile.typeId) {
            case "minecraft:arrow":
                attacker.playSound("random.orb", {pitch: 0.5});
                break;
            case "minecraft:snowball":
                attacker.playSound("random.orb", {pitch: 1.0});
                break;
            case "minecraft:fishing_hook":
                attacker.playSound("random.bow", {pitch: 2.0});
                break;
        }
    }

    // Save the cumulative damages for determining kills later
    if (!isValid(playerDamages[victim.id])) {
        playerDamages[victim.id] = {attackerID: damageAmount};
    } else if (!isValid(playerDamages[victim.id][attacker.id])) {
        playerDamages[victim.id][attacker.id] = damageAmount
    } else {
        playerDamages[victim.id][attacker.id] += damageAmount;
    }

    // log(victim.name, "was attacked by", attacker.name, "causing", damageAmount.toFixed(2), "damage.");
    // log(JSON.stringify(playerDamages));
});


world.afterEvents.entityHitEntity.subscribe(data => {
    if (!isValidPlayer(data.damagingEntity) || !isValidPlayer(data.hitEntity)) return;
    if (!(data.damagingEntity.id in playersSpawnProtection || data.hitEntity.id in playersSpawnProtection)) return;
    log(6)
});


// Delete Player damages when attacker leaves world
world.beforeEvents.playerLeave.subscribe(data => {
    delete playerDamages[data.player.id];
});


// Prevent using ender pearls outside the arena
world.beforeEvents.itemUse.subscribe(data => {
    if (data.itemStack.typeId !== "minecraft:ender_pearl") return;
    if (data.source.id in arenaPlayers) return;
    data.cancel = true;
});


// Prevent placing boats
world.beforeEvents.itemUseOn.subscribe(data => {
    if (data.itemStack.type.id.includes("boat")) {
        data.cancel = true;
    }
});


// entity timeout killer: add to list
world.afterEvents.entitySpawn.subscribe(data => {
    const typeID = data.entity.typeId;
    const entityID = data.entity.id;
    const now = new Date();

    switch (typeID) {
        case "minecraft:arrow":
        case "minecraft:item":
            entityTimestamps[entityID] = now;
            break;
    }
});


// entity timeout killer: remove entity
system.runInterval(() => {
    const now = new Date();

    Object.entries(entityTimestamps).forEach(([entityID, timestamp]) => {
        let entity = world.getEntity(entityID);
        if (!isValid(entity)) return;

        if ((now - timestamp)/1000 < entityKillTimes[entity.typeId]) return;
        delete entityTimestamps[entityID];
        entity.kill();
    });
}, 20);



// Increase Playtime
system.runInterval(() => {
    let scoreboardPlaytime = getObjective("playtime");

    world.getAllPlayers().forEach(player => {
        scoreboardPlaytime.addScore(player, 1);
    });
}, 1);


// Effects, location based stuff
system.runInterval(() => {
    world.getAllPlayers().forEach(player => {
        if (!player.isValid()) return;

        player.addEffect("night_vision", 20_000_000, {showParticles: false});

        const inLobby = isPointInsideVolume(lobbyVolume, player.location);
        const inJoinArena = isPointInsideVolume(joinArenaVolume, player.location);
        const inPreArena = isPointInsideVolume(preArenaVolume, player.location);
        const inArena = isPointInsideVolume(arenaVolume, player.location);

        if (inArena && !(player.id in arenaPlayers)) {
            // this occurs when an ender pearl lands after the player has died
            moveToSpawn(player);
            return;
        }

        if (!inArena) {
            kits.forEach(kit => player.removeTag(`kit_${kit}`));
            delete arenaPlayers[player.id];
            delete playersSpawnProtection[player.id];
        }

        if (inLobby) {
            if (![GameMode.creative, GameMode.spectator].includes(player.getGameMode())) {
                player.runCommand("clear");
            }
        }

        if (inLobby || inPreArena) {
            if (!admins.includes(player.name)) {
                player.setGameMode(GameMode.adventure);
            }

            player.addEffect("saturation", 60, {showParticles: false});
            player.addEffect("resistance", 60, {showParticles: false});
            player.addEffect("instant_health", 60, {showParticles: false});
        }

        if (inJoinArena) {
            arenaPlayers[player.id] = player;
            playersSpawnProtection[player.id] = new Date(new Date().getTime() + 5000);
            player.addEffect("weakness", 100, {showParticles: true});
            player.addEffect("resistance", 100, {showParticles: true});

            let spawnPosition = findArenaSpawn();
            player.teleport(spawnPosition);
            player.playSound("random.levelup", {volume: 1000, pitch: 0.5, location: spawnPosition});
            player.runCommand("inputpermission set @s jump enabled");    // TODO remove when better system
        }
    })
}, 2);


// Remove spawn protection
system.runInterval(() => {
    const now = new Date();

    Object.entries(playersSpawnProtection).forEach(([playerID, endTimestamp]) => {
        if (endTimestamp > now) return;

        delete playersSpawnProtection[playerID];
        const player = getPlayerByID(playerID);
        sendSubtitle("§cYour spawn protection has expired.", 2, 40, 10, [player]);
        player.playSound("random.anvil_land", {volume: 1000, pitch: 0.8});
    });
}, 10);


// Update Actionbar, Nametags, HUD visibility
system.runInterval(() => {
    let scoreboardPlaytime = getObjective("playtime");
    let scoreboardKills = getObjective("kills");
    let scoreboardDeaths = getObjective("deaths");

    let allPlayers = world.getAllPlayers();
    let onlineCount = allPlayers.length;

    allPlayers.forEach((player) => {
        let playtimeTotalTicks = scoreboardPlaytime.getScore(player);
        playtimeTotalTicks = isValid(playtimeTotalTicks) ? playtimeTotalTicks : 0;

        if (!isValidPlayer(player)) {
            return;
        }

        let kills = getScore(scoreboardKills, player);
        let deaths = getScore(scoreboardDeaths, player);
        let kdRatio = getKD(player, {kills: kills, deaths: deaths});
        let kdString = kdRatio.toFixed(2);

        let playtimeSeconds = Math.floor(playtimeTotalTicks / 20) % 60;
        let playtimeMinutes = Math.floor(playtimeTotalTicks / 20 / 60) % 60;
        let playtimeHours = Math.floor(playtimeTotalTicks / 20 / 60 / 60);

        let sec = String(playtimeSeconds).padStart(2, "0");
        let min = String(playtimeMinutes).padStart(2, "0");
        let hours = String(playtimeHours);

        let playtimeString = `${min}:${sec}`;
        if (playtimeHours > 0) {
            playtimeString = `${hours}:${min}:${sec}`;
        }

        let isArena = player.hasTag("arena");

        if (isArena) {
            player.onScreenDisplay.setActionBar(
                `§2Kills§r: ${kills}§r §i|§r §bKD§r: ${kdString}§r\n` +
                `§ePlaytime§r: ${playtimeString}§r\n` +
                `§dOnline§r: ${onlineCount}§r`
            );
        } else {
            player.onScreenDisplay.setActionBar(
                `§2Kills§r: ${kills} §i|§r §cDeaths§r: ${deaths}§r\n` +
                `§bKD§r: ${kdString}§r\n` +
                `§ePlaytime§r: ${playtimeString}§r\n` +
                `§dOnline§r: ${onlineCount}§r`
            );
        }

        let nametagColor = admins.includes(player.name) ? '§c' : '§e';

        // Custom Emojis from "Crystal Mett" Resource Pack  (https://wiki.bedrock.dev/concepts/emojis)
        let deviceIcon = '';
        switch (player.clientSystemInfo.platformType) {
            case PlatformType.Desktop:
                deviceIcon = '\uE1D2 ';
                break;
            case PlatformType.Mobile:
                deviceIcon = '\uE1D1 ';
                break;
            case PlatformType.Console:
                deviceIcon = '\uE1D0 ';
                break;
        }

        player.nameTag = `${nametagColor}${player.name}\n${deviceIcon}§iKD: ${kdString}§r`;

        player.onScreenDisplay.setHudVisibility(HudVisibility.Hide, [HudElement.ItemText]);

        // v  should be unnecessary if no player's spawnpoint is set (setworldspawn instead)
        player.setSpawnPoint({dimension: overworld, x: 10000, y: -39, z: 10000});
    })
}, 10);


// Update Leaderboard
system.runInterval(() => {
    let scoreboardLeaderboard = getObjective("leaderboard", "§gLeaderboard");
    scoreboardLeaderboard.getParticipants().forEach(participant => scoreboardLeaderboard.removeParticipant(participant));

    let allPlayers = world.getAllPlayers();
    let scoreboardKills = getObjective("kills");
    let scoreboardDeaths = getObjective("deaths");

    // Since the leaderboard is sorted by K/D ratio; you need to have at least 20 kills to appear
    // on the leaderboard so that players with 0 or 1 deaths can't reach Top 1 with just a few kills.

    let playersSorted = allPlayers
        .filter(player => getScore(scoreboardKills, player) >= 20)
        .sort((player1, player2) => {
            let kd1 = getKD(player1, {scoreboardKills: scoreboardKills, scoreboardDeaths: scoreboardDeaths});
            let kd2 = getKD(player2, {scoreboardKills: scoreboardKills, scoreboardDeaths: scoreboardDeaths});
            return (kd1 > kd2) ? -1 : 1;
        })
        .splice(-10, 10);


    playersSorted.forEach((player, index) => {
        scoreboardLeaderboard.setScore(player, index + 1);
    })
}, 500);


// Kick banned players
system.runInterval(() => {
    world.getPlayers({tags: ["ban"]}).forEach(player => {
        log(`§4Kicking banned player §c${player.name}§4.`);
        const banMessage = `§4You have been §mpermanently§4\nbanned from this world, loser!`;
        const command = `kick ${commandifyPlayerName(player.name)} \n${banMessage}`;
        overworld.runCommand(command);
    });
    // TODO unbanning
}, 10);


// Clear arena scheduler
system.runInterval(() => {
    let countdown = 6;

    const intervalID = system.runInterval(() => {
        if (countdown < 1) {
            system.clearRun(intervalID);
            clearArena();
            return;
        }
        sendSubtitle(`\n\n§2Clearing arena in §e${countdown}§2...`, 0, 25, 30);
        countdown--;
    }, 20);

}, 5 * 60 * TicksPerSecond);


// Alerts: Join Discord
system.runInterval(() => {
    world.sendMessage("§2Join the Discord for updates and hosting times or give us suggestions for kits: §5bit.ly/tomatigga§r");
}, 20 * 60 * 3.512);


// Alerts: Render Distance
system.runInterval(() => {
    sendSubtitle(`\n§cPlease set render\ndistance to 5!`, 0, 50, 10);
}, 20 * 60 * 2.34);


// Alerts: Add friend to play again
system.runInterval(() => {
    world.sendMessage("§dAdd §5latuskati§d, §5HeiligTomate §dand §5Tomatigga §dto play again!");
}, 20 * 60 * 4.26);



// Global variables
const lobbyVolume = {
    from: {
        x: 9990,
        y: -40,
        z: 9990
    },
    to: {
        x: 10010,
        y: -28,
        z: 10010
    }
}

const preArenaVolume = {
    from: {
        x: 9992,
        y: -1,
        z: 9994
    },
    to: {
        x: 10008,
        y: 5,
        z: 10009
    }
}

const joinArenaVolume = {
    from: {
        x: 9999,
        y: 0,
        z: 10006
    },
    to: {
        x: 10001,
        y: 3,
        z: 10008
    }
}

const arenaVolume = {
    from: {
        x: 19910,
        y: -64,
        z: 19910
    },
    to: {
        x: 20090,
        y: -39,
        z: 20090
    }
}

const kits = ["samurai", "sniper", "tank", "fighter", "maceling", "newgen"];

let playerDamages = {};                 // Dictionary<VictimPlayerID: Dictionary<AttackerPlayerID: DamageAmount>>

let entityTimestamps = {}               // Dictionary<EntityID: SpawnTimestampUnix>
const entityKillTimes = {
    "minecraft:arrow": 5.0,
    "minecraft:item": 25.0,
};                                          // Dictionary<EntityType: KillTimeSeconds>

const overworld = world.getDimension("overworld");

let arenaPlayers = {};                  // Dictionary<PlayerID: PlayerObject>
let playersSpawnProtection = {};        // Dictionary<PlayerID: SpawnProtectionEndTimestamp>


log("[§4KitFFA§r]§a Addon loaded!");



// TODO:    don't kill when ender pearl tp on arena roof
//          clamp position or smth when ender pearl tp through arena wall
//          prevent out of bounds in general??
//          prevent messing with armor stands
//          tutorial on first join
//          waterlogged cobweb clear
//          more alerts (add friend to play again, saw someone cheating, render distance)
//          unbanning
//          kit selection
//          kit get items
//          undroppable kit weapons
//          balancing regarding ender pearls, cobwebs (change dropped items from kill if possible)
//          remove duplicate items from inventory in general (buckets)
//          more kits (stealth kit, lifesteal/vampire are now possible with addon)
//          typescript
