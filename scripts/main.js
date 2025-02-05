import { BlockVolume, GameMode, HudElement, HudVisibility, PlatformType, Player, system, world } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
// function isValid(value: any): boolean {
//     if (value === undefined || typeof value === 'undefined') return false;
//     if (value === null) return false;
//     if (value instanceof Number && (isNaN(value as number) || !isFinite(value as number))) return false;
//     return true;
// }
function isValidPlayer(entity) {
    if (entity === null)
        return false;
    if (entity === undefined)
        return false;
    if (entity.typeId !== "minecraft:player")
        return false;
    if (!(entity instanceof Player))
        return false;
    if (!entity.isValid)
        return false;
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
    if (point.x < volume.from.x)
        return false;
    if (point.y < volume.from.y)
        return false;
    if (point.z < volume.from.z)
        return false;
    if (point.x > volume.to.x)
        return false;
    if (point.y > volume.to.y)
        return false;
    if (point.z > volume.to.z)
        return false;
    return true;
}
function getObjective(objectiveName, creationDisplayName) {
    let objective = world.scoreboard.getObjective(objectiveName);
    if (objective !== undefined) {
        return objective;
    }
    world.sendMessage(`[§gWARN§r] Creating objective "${objectiveName}" since it didn't exist!`);
    let objectiveDisplayName = objectiveName;
    if (creationDisplayName !== undefined) {
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
    const allPlayers = overworld.getPlayers();
    const playersFiltered = allPlayers.filter(player => player.id === playerID);
    if (playersFiltered.length === 0) {
        return null;
    }
    return playersFiltered[0];
}
// useful for debugging without spamming everyone in the server
function log(...args) {
    let players = overworld.getPlayers().filter(player => admins.includes(player.name));
    players.forEach(player => player.sendMessage(args.join(" ")));
}
function sendSubtitle(message, fadeIn, stay, fadeOut, players) {
    if (players === undefined) {
        players = overworld.getPlayers();
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
    player.runCommand("tp @s 10000 -39 10000 0 0");
    player.runCommand("inputpermission set @s jump enabled");
}
function getKD(player, options = {}) {
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
    deaths = deaths === 0 ? 1 : deaths; // prevent zero division
    let kdRatio = kills / deaths;
    return kdRatio;
}
function showKillstreakMessage(player, killstreak) {
    const pluralSuffix = killstreak >= 2 ? "s" : "";
    if (killstreak % 5 === 0) {
        sendSubtitle(`\n\n\n§b${killstreak}§s Kill${pluralSuffix}!`, 0, 35, 7, [player]);
    }
    else {
        sendSubtitle(`\n\n\n§e${killstreak}§g Kill${pluralSuffix}!`, 0, 15, 2, [player]);
    }
    if (killstreak % 10 === 0) {
        world.sendMessage(`§5${player.name}§d is on a killing spree!`);
    }
}
function generateCuboids(bigCuboid, volumeLimit) {
    const cuboids = [];
    function splitCuboid(cuboid) {
        const volume = cuboid.w * cuboid.h * cuboid.d;
        // Base Case: If the volume is within the limit, add cuboid
        if (volume <= volumeLimit) {
            cuboids.push(cuboid);
            return;
        }
        // Find the longest dimension to split
        if (cuboid.w >= cuboid.h && cuboid.w >= cuboid.d) {
            // Split along width
            let maxW = Math.min(cuboid.w, Math.floor(volumeLimit / (cuboid.h * cuboid.d)));
            if (maxW === 0)
                maxW = 1; // Ensure progress
            splitCuboid({ x: cuboid.x, y: cuboid.y, z: cuboid.z, w: maxW, h: cuboid.h, d: cuboid.d });
            splitCuboid({ x: cuboid.x + maxW, y: cuboid.y, z: cuboid.z, w: cuboid.w - maxW, h: cuboid.h, d: cuboid.d });
        }
        else if (cuboid.h >= cuboid.w && cuboid.h >= cuboid.d) {
            // Split along height
            let maxH = Math.min(cuboid.h, Math.floor(volumeLimit / (cuboid.w * cuboid.d)));
            if (maxH === 0)
                maxH = 1;
            splitCuboid({ x: cuboid.x, y: cuboid.y, z: cuboid.z, w: cuboid.w, h: maxH, d: cuboid.d });
            splitCuboid({ x: cuboid.x, y: cuboid.y + maxH, z: cuboid.z, w: cuboid.w, h: cuboid.h - maxH, d: cuboid.d });
        }
        else {
            // Split along depth
            let maxD = Math.min(cuboid.d, Math.floor(volumeLimit / (cuboid.w * cuboid.h)));
            if (maxD === 0)
                maxD = 1;
            splitCuboid({ x: cuboid.x, y: cuboid.y, z: cuboid.z, w: cuboid.w, h: cuboid.h, d: maxD });
            splitCuboid({ x: cuboid.x, y: cuboid.y, z: cuboid.z + maxD, w: cuboid.w, h: cuboid.h, d: cuboid.d - maxD });
        }
    }
    // Start with the full cuboid at origin (0, 0, 0)
    splitCuboid({ x: 0, y: 0, z: 0, w: bigCuboid.w, h: bigCuboid.h, d: bigCuboid.d });
    return cuboids;
}
function fillBlocks(dimension, volume, block, options) {
    // Fills blocks while bypassing the 32768 block limit
    const bigCuboid = {
        x: 0, y: 0, z: 0,
        w: 1 + volume.to.x - volume.from.x,
        h: 1 + volume.to.y - volume.from.y,
        d: 1 + volume.to.z - volume.from.z
    };
    const normalizedCuboids = generateCuboids(bigCuboid, 32768);
    normalizedCuboids.forEach(normalizedCuboid => {
        const cuboidPositionFrom = {
            x: volume.from.x + normalizedCuboid.x,
            y: volume.from.y + normalizedCuboid.y,
            z: volume.from.z + normalizedCuboid.z
        };
        const cuboidPositionTo = {
            x: cuboidPositionFrom.x + normalizedCuboid.w - 1,
            y: cuboidPositionFrom.y + normalizedCuboid.h - 1,
            z: cuboidPositionFrom.z + normalizedCuboid.d - 1
        };
        const blockVolume = new BlockVolume(cuboidPositionFrom, cuboidPositionTo);
        dimension.fillBlocks(blockVolume, block, options);
    });
}
function clearArena() {
    world.sendMessage("§aClearing Arena...");
    const groundVolume = {
        from: {
            x: arenaVolume.from.x + 1,
            y: arenaVolume.from.y,
            z: arenaVolume.from.x + 1
        },
        to: {
            x: arenaVolume.to.x - 1,
            y: arenaVolume.from.y,
            z: arenaVolume.to.z - 1
        }
    };
    fillBlocks(overworld, groundVolume, "minecraft:allow");
    const dirtVolume = {
        from: {
            x: arenaVolume.from.x + 1,
            y: arenaVolume.from.y + 1,
            z: arenaVolume.from.x + 1
        },
        to: {
            x: arenaVolume.to.x - 1,
            y: arenaVolume.from.y + 2,
            z: arenaVolume.to.z - 1
        }
    };
    fillBlocks(overworld, dirtVolume, "minecraft:dirt");
    const grassVolume = {
        from: {
            x: arenaVolume.from.x + 1,
            y: arenaVolume.from.y + 3,
            z: arenaVolume.from.x + 1
        },
        to: {
            x: arenaVolume.to.x - 1,
            y: arenaVolume.from.y + 3,
            z: arenaVolume.to.z - 1
        }
    };
    fillBlocks(overworld, grassVolume, "minecraft:grass_block");
    const airVolume = {
        from: {
            x: arenaVolume.from.x + 1,
            y: arenaVolume.from.y + 4,
            z: arenaVolume.from.z + 1
        },
        to: {
            x: arenaVolume.to.x - 1,
            y: arenaVolume.to.y, // -0 instead of -1 because the waterlogged barriers don't get replaced otherwise
            z: arenaVolume.to.z - 1
        }
    };
    fillBlocks(overworld, airVolume, "minecraft:air");
    // This does what the fix above SHOULD'VE done, but for some reason, it doesn't work otherwise
    fillBlocks(overworld, airVolume, "minecraft:air");
    const roofVolume = {
        from: {
            x: arenaVolume.from.x,
            y: arenaVolume.to.y,
            z: arenaVolume.from.z
        },
        to: {
            x: arenaVolume.to.x,
            y: arenaVolume.to.y,
            z: arenaVolume.to.z
        }
    };
    fillBlocks(overworld, roofVolume, "minecraft:barrier");
    const wallX1Volume = {
        from: {
            x: arenaVolume.from.x,
            y: arenaVolume.from.y,
            z: arenaVolume.from.z
        },
        to: {
            x: arenaVolume.from.x,
            y: arenaVolume.to.y - 1,
            z: arenaVolume.to.z
        }
    };
    fillBlocks(overworld, wallX1Volume, "minecraft:bedrock");
    const wallX2Volume = {
        from: {
            x: arenaVolume.to.x,
            y: arenaVolume.from.y,
            z: arenaVolume.from.z
        },
        to: {
            x: arenaVolume.to.x,
            y: arenaVolume.to.y - 1,
            z: arenaVolume.to.z
        }
    };
    fillBlocks(overworld, wallX2Volume, "minecraft:bedrock");
    const wallZ1Volume = {
        from: {
            x: arenaVolume.from.x,
            y: arenaVolume.from.y,
            z: arenaVolume.from.z
        },
        to: {
            x: arenaVolume.to.x,
            y: arenaVolume.to.y - 1,
            z: arenaVolume.from.z
        }
    };
    fillBlocks(overworld, wallZ1Volume, "minecraft:bedrock");
    const wallZ2Volume = {
        from: {
            x: arenaVolume.from.x,
            y: arenaVolume.from.y,
            z: arenaVolume.to.z
        },
        to: {
            x: arenaVolume.to.x,
            y: arenaVolume.to.y - 1,
            z: arenaVolume.to.z
        }
    };
    fillBlocks(overworld, wallZ2Volume, "minecraft:bedrock");
    // Extra air on top of the arena
    const airOnRoofVolume = {
        from: {
            x: arenaVolume.from.x,
            y: arenaVolume.to.y + 1,
            z: arenaVolume.from.z
        },
        to: {
            x: arenaVolume.to.x,
            y: arenaVolume.to.y + 6,
            z: arenaVolume.to.z
        }
    };
    fillBlocks(overworld, airOnRoofVolume, "minecraft:air");
    world.sendMessage("§aArena cleared!");
    sendSubtitle("\n\n§aArena cleared!", 3, 28, 21);
}
function findArenaSpawn() {
    const attemptCount = 20;
    for (let i = 0; i < attemptCount; i++) {
        const x = Math.floor(arenaVolume.from.x + Math.random() * (arenaVolume.to.x - arenaVolume.from.x));
        const z = Math.floor(arenaVolume.from.z + Math.random() * (arenaVolume.to.z - arenaVolume.from.z));
        const location = { dimension: overworld, x: x, y: arenaVolume.from.y + 4, z: z };
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
        dimension: overworld,
        x: arenaVolume.from.x + (arenaVolume.to.x - arenaVolume.from.x) / 2,
        y: arenaVolume.from.y + 4,
        z: arenaVolume.from.z + (arenaVolume.to.z - arenaVolume.from.z) / 2
    };
}
function setLobbyInventory(player) {
    // player.runCommand(`replaceitem entity @s slot.armor.head 0 air`);
    // player.runCommand(`replaceitem entity @s slot.armor.chest 0 air`);
    // player.runCommand(`replaceitem entity @s slot.armor.legs 0 air`);
    // player.runCommand(`replaceitem entity @s slot.armor.feet 0 air`);
    // player.runCommand(`replaceitem entity @s slot.weapon.offhand 0 air`);
    //
    // for (let i = 0; i < 27; i++) {
    //     player.runCommand(`replaceitem entity @s slot.inventory ${i} air`);
    // }
    //
    // for (let i = 1; i < 9; i++) {
    //     player.runCommand(`replaceitem entity @s slot.hotbar ${i} air`);
    // }
    for (let i = 0; i < 4; i++) {
        player.runCommand(`replaceitem entity @s[hasitem={item=compass, quantity=0}] slot.hotbar ${i} amethyst_shard`);
    }
    player.runCommand('give @s[hasitem={item=compass, quantity=0}] compass 1 0 {"minecraft:item_lock": {"mode": "lock_in_inventory"}}');
    player.runCommand('clear @s amethyst_shard');
}
// teleport joined and respawned players into lobby
world.afterEvents.playerSpawn.subscribe(event => {
    moveToSpawn(event.player);
    // Greet joined players
    if (event.initialSpawn) {
        event.player.playSound("random.levelup");
        event.player.onScreenDisplay.setTitle("§gWelcome!", { fadeInDuration: 30, stayDuration: 40, fadeOutDuration: 30 });
    }
});
// handle kill, death
world.afterEvents.entityDie.subscribe(event => {
    if (!isValidPlayer(event.deadEntity)) {
        return;
    }
    let scoreboardDeaths = getObjective("deaths");
    let scoreboardKills = getObjective("kills");
    let scoreboardKillstreak = getObjective("killstreak");
    scoreboardDeaths.addScore(event.deadEntity, 1);
    scoreboardKillstreak.setScore(event.deadEntity, 0);
    // Try to find a killer by finding the player who dealt the most damage to the victim
    let attacker = null;
    let attackersSorted = [];
    if (event.deadEntity.id in playerDamages) {
        attackersSorted = Object.entries(playerDamages[event.deadEntity.id]);
        if (attackersSorted.length > 0) {
            attackersSorted = attackersSorted.filter(([, damage]) => damage >= 5);
            attackersSorted.sort(([, damage1], [, damage2]) => damage1 > damage2 ? -1 : 1);
        }
    }
    if (attackersSorted.length > 0) {
        let attackerID = attackersSorted[0][0];
        attacker = getPlayerByID(attackerID); // return value can be null
    }
    else if (isValidPlayer(event.damageSource?.damagingEntity)) {
        attacker = event.damageSource.damagingEntity;
    }
    delete playerDamages[event.deadEntity.id];
    if (attacker === null)
        return;
    const attackerIsInArena = attacker.hasTag("arena");
    scoreboardKills.addScore(attacker, 1);
    attacker.playSound("dig.snow", { pitch: 1 });
    attacker.playSound("break.amethyst_cluster", { pitch: 1.7 });
    if (!attackerIsInArena)
        return;
    scoreboardKillstreak.addScore(attacker, 1);
    const attackerKillstreak = scoreboardKillstreak.getScore(attacker);
    showKillstreakMessage(attacker, attackerKillstreak);
    attacker.addEffect("absorption", 600, { amplifier: 0, showParticles: false });
    attacker.addEffect("regeneration", 100, { amplifier: 2, showParticles: true });
    // attacker.addEffect("saturation", 20, {amplifier: 0, showParticles: true});
    attacker.runCommand("give @s pale_oak_planks 8");
    attacker.runCommand("give @s web 2");
    if (attackerKillstreak % 3 === 0) {
        attacker.runCommand("give @s cooked_chicken");
    }
    if (attackerKillstreak % 3 === 1) {
        attacker.runCommand("give @s ender_pearl");
    }
    if (attackerKillstreak % 2 === 1) {
        attacker.runCommand("give @s[hasitem={item=wind_charge}] wind_charge 4");
    }
});
// Keep track of player damages to determine who to award the kill if the death is indirect (fall damage, ender pearl damage, lava, fire, burning)
world.afterEvents.entityHurt.subscribe(event => {
    if (!isValidPlayer(event.hurtEntity) || !isValidPlayer(event.damageSource?.damagingEntity)) {
        return;
    }
    const victim = event.hurtEntity;
    const attacker = event.damageSource.damagingEntity;
    const damageAmount = event.damage;
    // Projectile hit confirmation sound
    if (event.damageSource?.damagingProjectile !== undefined) {
        switch (event.damageSource.damagingProjectile.typeId) {
            case "minecraft:arrow":
                attacker.playSound("random.orb", { pitch: 0.5 });
                break;
            case "minecraft:snowball":
                attacker.playSound("random.orb", { pitch: 1.0 });
                break;
            case "minecraft:fishing_hook":
                attacker.playSound("random.bow", { pitch: 2.0 });
                break;
        }
    }
    // Save the cumulative damages for determining kills later
    if (!(victim.id in playerDamages)) {
        playerDamages[victim.id] = { attackerID: damageAmount };
    }
    else if (!(attacker.id in playerDamages[victim.id])) {
        playerDamages[victim.id][attacker.id] = damageAmount;
    }
    else {
        playerDamages[victim.id][attacker.id] += damageAmount;
    }
    // log(victim.name, "was attacked by", attacker.name, "causing", damageAmount.toFixed(2), "damage.");
    // log(JSON.stringify(playerDamages));
});
// world.afterEvents.entityHitEntity.subscribe(event => {
//     if (!isValidPlayer(event.damagingEntity)) return;
//     if (!isValidPlayer(event.hitEntity)) return;
//     if (!(event.damagingEntity.id in playersSpawnProtection || event.hitEntity.id in playersSpawnProtection)) return;
//     log(6)
// });
// Delete Player damages when attacker leaves world
world.beforeEvents.playerLeave.subscribe(event => {
    delete playerDamages[event.player.id];
});
// Prevent using ender pearls outside the arena
world.beforeEvents.itemUse.subscribe(event => {
    if (event.itemStack.typeId !== "minecraft:ender_pearl")
        return;
    if (event.source.id in arenaPlayers)
        return;
    event.cancel = true;
});
// Prevent placing boats
world.beforeEvents.itemUseOn.subscribe(event => {
    if (event.itemStack.type.id.includes("boat")) {
        event.cancel = true;
    }
});
// entity timeout killer: add to list
world.afterEvents.entitySpawn.subscribe(event => {
    if (!(event.entity.typeId in entityKillTimes))
        return;
    const killTimeTicks = entityKillTimes[event.entity.typeId];
    system.waitTicks(killTimeTicks).then(() => {
        try {
            event.entity.kill();
        }
        catch (err) {
            console.info(`@EntityTimeout: Could not kill entity "${event.entity.typeId}".`);
        }
    }).catch(err => {
        console.error(err, err.stack);
    });
});
// Prevent waterlogged cobwebs
world.afterEvents.itemUseOn.subscribe(event => {
    if (event.itemStack.type.id !== "minecraft:water_bucket")
        return;
    if (!event.block.matches("web"))
        return;
    event.block.setType("water");
});
// Form: Kit Selection
world.afterEvents.itemUse.subscribe(event => {
    if (event.itemStack.typeId !== "minecraft:compass")
        return;
    const player = event.source;
    let form = new ActionFormData();
    form.title("§lKit Selection");
    form.body("§i---§r Select your preferred Kit here! §i----§r\n ");
    kitNames.forEach(kitName => form.button(kitName));
    form.show(player).then(resp => {
        if (resp.canceled)
            return;
        let kit = kits[resp.selection];
        player.runCommand("clear");
        player.runCommand(`loot give @s loot kit_${kit}`);
        player.runCommand(`loot replace entity @s slot.weapon.offhand 0 loot kit_${kit}_armor`);
        player.runCommand("clear @s amethyst_shard");
        arenaPlayers[player.id] = player;
        playersSpawnProtection[player.id] = system.currentTick + spawnProtectionTicks;
        player.addEffect("mining_fatigue", spawnProtectionTicks, { showParticles: true, amplifier: 2 });
        player.addEffect("weakness", spawnProtectionTicks, { showParticles: true, amplifier: 255 });
        player.addEffect("instant_health", spawnProtectionTicks, { showParticles: true, amplifier: 255 });
        let spawnPosition = findArenaSpawn();
        player.teleport(spawnPosition);
        player.playSound("random.levelup", { volume: 1000, pitch: 0.5, location: spawnPosition });
    }).catch(err => {
        console.error(err, err.stack);
    });
});
// Increase Playtime
system.runInterval(() => {
    let scoreboardPlaytime = getObjective("playtime");
    overworld.getPlayers().forEach(player => {
        scoreboardPlaytime.addScore(player, 1);
    });
}, 1);
// Effects, location based stuff
system.runInterval(() => {
    overworld.getPlayers().forEach(player => {
        if (!player.isValid)
            return;
        player.addEffect("night_vision", 20_000_000, { showParticles: false });
        const inLobby = isPointInsideVolume(lobbyVolume, player.location);
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
                setLobbyInventory(player);
            }
            if (!admins.includes(player.name)) {
                player.setGameMode(GameMode.adventure);
            }
            player.addEffect("saturation", 100, { showParticles: false });
            player.addEffect("resistance", 100, { showParticles: false });
            player.addEffect("instant_health", 100, { showParticles: false });
        }
    });
}, 2);
// Remove spawn protection
system.runInterval(() => {
    Object.entries(playersSpawnProtection).forEach(([playerID, endTick]) => {
        if (system.currentTick < endTick)
            return;
        delete playersSpawnProtection[playerID];
        const player = getPlayerByID(playerID);
        sendSubtitle("§cYour spawn protection has expired.", 2, 40, 10, [player]);
        player.playSound("random.anvil_land", { volume: 1000, pitch: 0.8 });
    });
}, 10);
// Update Actionbar, Nametags, HUD visibility
system.runInterval(() => {
    let scoreboardPlaytime = getObjective("playtime");
    let scoreboardKills = getObjective("kills");
    let scoreboardDeaths = getObjective("deaths");
    let allPlayers = overworld.getPlayers();
    let onlineCount = allPlayers.length;
    allPlayers.forEach((player) => {
        let playtimeTotalTicks = scoreboardPlaytime.getScore(player);
        playtimeTotalTicks = playtimeTotalTicks === undefined ? 0 : playtimeTotalTicks;
        if (!isValidPlayer(player)) {
            return;
        }
        let kills = getScore(scoreboardKills, player);
        let deaths = getScore(scoreboardDeaths, player);
        let kdRatio = getKD(player, { kills: kills, deaths: deaths });
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
            player.onScreenDisplay.setActionBar(`§2Kills§r: ${kills}§r §i|§r §bKD§r: ${kdString}§r\n` +
                `§ePlaytime§r: ${playtimeString}§r\n` +
                `§dOnline§r: ${onlineCount}§r`);
        }
        else {
            player.onScreenDisplay.setActionBar(`§2Kills§r: ${kills} §i|§r §cDeaths§r: ${deaths}§r\n` +
                `§bKD§r: ${kdString}§r\n` +
                `§ePlaytime§r: ${playtimeString}§r\n` +
                `§dOnline§r: ${onlineCount}§r`);
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
        player.setSpawnPoint({ dimension: overworld, x: 10000, y: -39, z: 10000 });
    });
}, 10);
// Update Leaderboard
system.runInterval(() => {
    let scoreboardLeaderboard = getObjective("leaderboard", "§gLeaderboard");
    scoreboardLeaderboard.getParticipants().forEach(participant => scoreboardLeaderboard.removeParticipant(participant));
    let allPlayers = overworld.getPlayers();
    let scoreboardKills = getObjective("kills");
    let scoreboardDeaths = getObjective("deaths");
    // Since the leaderboard is sorted by K/D ratio; you need to have at least 20 kills to appear
    // on the leaderboard so that players with 0 or 1 deaths can't reach Top 1 with just a few kills.
    let playersSorted = allPlayers
        .filter(player => getScore(scoreboardKills, player) >= 20)
        .sort((player1, player2) => {
        let kd1 = getKD(player1, { scoreboardKills: scoreboardKills, scoreboardDeaths: scoreboardDeaths });
        let kd2 = getKD(player2, { scoreboardKills: scoreboardKills, scoreboardDeaths: scoreboardDeaths });
        return (kd1 > kd2) ? -1 : 1;
    })
        .splice(-10, 10);
    playersSorted.forEach((player, index) => {
        scoreboardLeaderboard.setScore(player, index + 1);
    });
}, 500);
// Kick banned players
system.runInterval(() => {
    world.getPlayers({ tags: ["ban"] }).forEach(player => {
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
}, 20 * 60 * 5);
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
// Constants
const playerNameCharset = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 ()".split("");
const admins = [
    "BioTomateDE",
    "HeiligTomate",
    "latuskati",
    "Tomatigga"
];
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
};
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
};
const kits = ["samurai", "sniper", "tank", "fighter", "maceling", "newgen"];
const kitNames = ["§sSamurai", "§nSniper", "§5Tank", "§cFighter", "§9Maceling", "§gNewgen"];
const entityKillTimes = {
    "minecraft:arrow": 20 * 5,
    "minecraft:item": 1,
}; // Dictionary[EntityType: KillTimeTicks]
const spawnProtectionTicks = 20 * 6;
const overworld = world.getDimension("overworld");
// Global Variables
let arenaPlayers = {}; // Dictionary<PlayerID: PlayerObject>
let playerDamages = {}; // Dictionary[VictimPlayerID: Dictionary[AttackerPlayerID: DamageAmount]]
let playersSpawnProtection = {}; // Dictionary<PlayerID: SpawnProtectionEndTick>
log("[§4KitFFA§r]§a Addon loaded!");
// TODO:    don't kill when ender pearl tp on arena roof
//          clamp position or smth when ender pearl tp through arena wall
//          prevent out of bounds in general??
//          prevent messing with armor stands
//          tutorial on first join
//          unbanning
//          balancing regarding ender pearls, cobwebs (change dropped items from kill if possible)
//          more kits (stealth kit, lifesteal/vampire are now possible with addon)
