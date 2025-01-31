import {world, system, Player, Entity, PlatformType} from "@minecraft/server";

const admins = [
    "BioTomateDE",
    "HeiligTomate",
    "latuskati",
    "Tomatigga"
]


function getObjective(objectiveName) {
    let objective = world.scoreboard.getObjective(objectiveName);
    if (objective !== undefined) {
        return objective;
    }
    world.sendMessage(`[§gWARN§r] Creating objective "${objectiveName}" since it didn't exist!`);
    return world.scoreboard.addObjective(objectiveName);
}


// useful for debugging without spamming everyone in the server
function log(...args) {
    let players = world.getAllPlayers().filter(player => admins.includes(player.name));
    players.forEach(player => player.sendMessage(String(...args)));
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
    if (data.deadEntity.typeId !== "minecraft:player") {
        return;
    }

    let scoreboardDeaths = getObjective("deaths");
    let scoreboardKills = getObjective("kills");
    let scoreboardKillstreak = getObjective("kill_streak");

    scoreboardDeaths.addScore(data.deadEntity, 1);
    scoreboardKillstreak.setScore(data.deadEntity, 0);

    if (data.damageSource?.damagingEntity === undefined || data.damageSource.damagingEntity.typeId !== "minecraft:player") {
        return;
    }

    let attacker = data.damageSource.damagingEntity;
    scoreboardKills.addScore(attacker, 1);
    scoreboardKillstreak.addScore(attacker, 1);
    attacker.playSound("random.orb", {pitch: 2})
    attacker.addEffect("absorption", 600, {amplifier: 0, showParticles: false});
    attacker.addEffect("saturation", 20, {amplifier: 0, showParticles: true});
    attacker.addEffect("regeneration", 100, {amplifier: 2, showParticles: true});
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

        let kills = scoreboardKills.getScore(player);
        kills = kills === undefined ? 0 : kills;

        let deaths = scoreboardDeaths.getScore(player);
        deaths = deaths === undefined ? 0 : deaths;

        let killstreak = scoreboardKillstreak.getScore(player);
        killstreak = killstreak === undefined ? 0 : killstreak;

        // prevent zero division
        let deaths_for_kd = deaths === 0 ? 1 : deaths;
        let kdRatio = kills / deaths_for_kd;
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

        // https://wiki.bedrock.dev/concepts/emojis
        let deviceIcon = '';
        switch (player.clientSystemInfo.platformType) {
            case PlatformType.Desktop:
                deviceIcon = '\uE070 ';   // Keyboard & Mouse: "Small Left Click"
                break;
            case PlatformType.Mobile:
                deviceIcon = '\uE015 ';   // New Touch: "Attack"
                break;
            case PlatformType.Console:
                deviceIcon = '\uE020 '   // PlayStation (4/5): "Cross"
                break;
        }

        player.nameTag = `${nametagColor}${player.name}\n${deviceIcon}§iKD: ${kdString}§r`;
    })


}, 10);


log("§aPlugin loaded!")