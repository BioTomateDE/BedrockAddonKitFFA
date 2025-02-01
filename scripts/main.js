import {world, system, Player, Entity, PlatformType} from "@minecraft/server";

const admins = [
    "BioTomateDE",
    "HeiligTomate",
    "latuskati",
    "Tomatigga"
]


function getObjective(objectiveName, creationDisplayName=null) {
    let objective = world.scoreboard.getObjective(objectiveName);
    if (objective !== undefined) {
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
    if (score === undefined) {
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


function getKD(player, options={}) {
    let scoreboardKills = options['scoreboardKills'];
    let scoreboardDeaths = options['scoreboardDeaths'];
    let kills = options['kills'];
    let deaths = options['deaths'];

    if (kills === undefined) {
        if (scoreboardKills === undefined) {
            scoreboardKills = getObjective("kills");
        }
        kills = getScore(scoreboardKills, player);
    }

    if (deaths === undefined) {
        if (scoreboardDeaths === undefined) {
            scoreboardDeaths = getObjective("deaths");
        }
        deaths = getScore(scoreboardDeaths, player);
    }

    deaths = deaths === 0 ? 1 : deaths;    // prevent zero division
    let kdRatio = kills / deaths;
    return kdRatio;
}


// spawn joined players into lobby
world.afterEvents.playerSpawn.subscribe(data => {
    if (!data.initialSpawn) {
        return;
    }

    // player just joined the game; move to spawn
    data.player.runCommand("clear @s");
    data.player.runCommand("effect @s clear");
    data.player.removeTag("arena");
    data.player.runCommand("tp @s 10000 -39 10000 -90 0");
    data.player.runCommand("inputpermission set @s jump enabled");
});


// handle kill, death
world.afterEvents.entityDie.subscribe(data => {
    if (data.deadEntity.typeId !== "minecraft:player" || !data.deadEntity.isValid()) {
        return;
    }

    let scoreboardDeaths = getObjective("deaths");
    let scoreboardKills = getObjective("kills");
    let scoreboardKillstreak = getObjective("kill_streak");

    scoreboardDeaths.addScore(data.deadEntity, 1);
    scoreboardKillstreak.setScore(data.deadEntity, 0);

    let attacker;
    // Try to find a killer by finding the player who dealt the most damage to the victim
    let attackersSorted = Object.entries(playerDamages[data.deadEntity.id])
        .filter(([attacker, damage]) => damage >= 5)
        .toSorted(([attacker1, damage1], [attacker2, damage2]) => damage1 > damage2 ? -1 : 1);

    if (attackersSorted.length === 0) {
        // No attacker with enough damage found, try to give the kill to the "actual" killer
        if (
            data.damageSource?.damagingEntity === undefined ||
            data.damageSource.damagingEntity.typeId !== "minecraft:player" ||
            !data.damageSource.damagingEntity.isValid()
        ) {
            delete playerDamages[data.deadEntity.id];
            return;
        }
        else {
            attacker = data.damageSource.damagingEntity;
        }
    } else {
        let attackerID = attackersSorted[0][0];
        attacker = getPlayerByID(attackerID);
    }

    delete playerDamages[data.deadEntity.id];

    const attackerIsInArena = attacker.hasTag("arena");
    scoreboardKills.addScore(attacker, 1);
    attacker.playSound("random.orb", {pitch: 2});

    if (attackerIsInArena) {
        scoreboardKillstreak.addScore(attacker, 1);
        attacker.addEffect("absorption", 600, {amplifier: 0, showParticles: false});
        attacker.addEffect("regeneration", 100, {amplifier: 2, showParticles: true});
        attacker.addEffect("saturation", 20, {amplifier: 0, showParticles: true});
    }
});


// Keep track of player damages to determine who to award the kill if the death is indirect (fall damage, ender pearl damage, lava, fire, burning)
world.afterEvents.entityHurt.subscribe(data => {
    if (
        data.hurtEntity.typeId !== "minecraft:player" ||
        !data.hurtEntity.isValid() ||
        data.damageSource?.damagingEntity === undefined ||
        data.damageSource.damagingEntity.typeId !== "minecraft:player" ||
        !data.damageSource.damagingEntity.isValid()
    ) {
        return;
    }

    const victimID = data.hurtEntity.id;
    const attackerID = data.damageSource.damagingEntity.id;
    const damageAmount = data.damage;

    if (playerDamages[victimID] === undefined) {
        playerDamages[victimID] = {attackerID: damageAmount};
    }
    else if (playerDamages[victimID][attackerID] === undefined) {
        playerDamages[victimID][attackerID] = damageAmount
    }
    else {
        playerDamages[victimID][attackerID] += damageAmount;
    }

    // log(data.hurtEntity.name, "was attacked by", data.damageSource.damagingEntity.name, "causing", damageAmount.toFixed(2), "damage.");
    // log(JSON.stringify(playerDamages))
});


world.beforeEvents.playerLeave.subscribe(data => {
    delete playerDamages[data.player.id];
});


// increase playtime
system.runInterval(() => {
    let scoreboardPlaytime = getObjective("playtime");

    world.getAllPlayers().forEach((player) => {
        scoreboardPlaytime.addScore(player, 1);
    })

}, 1);


// update actionbar and nametags
system.runInterval(() => {
    let scoreboardPlaytime = getObjective("playtime");
    let scoreboardKills = getObjective("kills");
    let scoreboardDeaths = getObjective("deaths");
    let scoreboardKillstreak = getObjective("kill_streak");

    let allPlayers = world.getAllPlayers();
    let onlineCount = allPlayers.length;

    allPlayers.forEach((player) => {
        let playtimeTotalTicks = scoreboardPlaytime.getScore(player);
        playtimeTotalTicks = playtimeTotalTicks === undefined ? 0 : playtimeTotalTicks;

        if (player.typeId !== "minecraft:player") {
            return;
        }

        let killstreak = getScore(scoreboardKillstreak, player);

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
                `§2Kills§r: ${kills}§r\n` +
                `§uKillstreak§r: ${killstreak}§r\n` +
                `§ePlaytime§r: ${playtimeString}§r`
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

        // Custom Emojis from "Crystal Mett" RP  (https://wiki.bedrock.dev/concepts/emojis)
        let deviceIcon = '';
        switch (player.clientSystemInfo.platformType) {
            case PlatformType.Desktop:
                deviceIcon = '\uE1D2 ';
                break;
            case PlatformType.Mobile:
                deviceIcon = '\uE1D1 ';
                break;
            case PlatformType.Console:
                deviceIcon = '\uE1D0 '
                break;
        }

        player.nameTag = `${nametagColor}${player.name}\n${deviceIcon}§iKD: ${kdString}§r`;
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


// Global variables

// Dictionary<VictimPlayerID, Dictionary<AttackerPlayerID, DamageAmount>>
let playerDamages = {}


log("§aPlugin loaded!");
