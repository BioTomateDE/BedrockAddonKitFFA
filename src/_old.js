function getDistance(location1, location2) {
    let x = location1.x - location2.x;
    let y = location1.y - location2.y;
    let z = location1.z - location2.z;
    return Math.hypot(x, y, z);
}


class EnderPearlThrow {
    constructor(player, location) {
        this.player = player;
        this.location = location;
        this.timestamp = new Date();
    }
}



// v GLOBAL VARIABLES
let enderPearlThrows = [];

system.runInterval(() => {
    let now = new Date();
    enderPearlThrows = enderPearlThrows.filter(enderPearlThrow => now - enderPearlThrow.timestamp < 690);
}, 100);
// ^ GLOBAL VARIABLES

world.beforeEvents.itemUse.subscribe(data => {
    if (data.itemStack.typeId !== "minecraft:ender_pearl") {
        return;
    }

    world.sendMessage(`§bitemUse§r  ${data.itemStack.typeId} ${data.source.name}`);
    enderPearlThrows.push(new EnderPearlThrow(data.source, data.source.location));
});

world.afterEvents.entitySpawn.subscribe(data => {
    // world.sendMessage(`${data.cause}`)
    if (data.entity.typeId !== "minecraft:ender_pearl") {
        return;
    }

    world.sendMessage(`§bentitySpawn§r <${data.entity.location.x} ${data.entity.location.y} ${data.entity.location.z}>`);

    let pearlDistances = enderPearlThrows.map(enderPearlThrow => getDistance(enderPearlThrow.location, data.entity.location));
    world.sendMessage(`dsdfdsf ${pearlDistances[0]}`)
})



world.afterEvents.projectileHitBlock.subscribe(data => {
    world.sendMessage(`§bprojectileHitBlock§r <${data.location.x} ${data.location.y} ${data.location.z}> ${data.projectile.typeId} ${data.source?.typeId}`)
});





let dfs = [];
for (let i = 0; i < 500; i++) {
    dfs.push(`${i.toString(16)}      ${String.fromCharCode(0xE000 + i)}`);
}
log(dfs.join("\n \n"))




// Prevent interacting with blocks (such as Crafting Tables, hidden Chests/Barrels/Dispensers)
world.beforeEvents.playerInteractWithBlock.subscribe(data => {
    log(data.player.isSneaking, data.block.typeId, data.blockFace, data.faceLocation.x.toFixed(2), data.faceLocation.y.toFixed(2), data.faceLocation.z.toFixed(2), data.isFirstEvent, data.itemStack?.typeId)

    // `data.player.isSneaking` is delayed and therefore insecure.
    if (data.player.isSneaking) return;
    if (admins.includes(data.player.name)) return;

    const forbiddenBlocks = [
        "crafting_table",
        "chest",
        "trapped_chest",
        "barrel",
        "hopper",
        "dropper",
        "dispenser",
        "furnace",
        "blast_furnace",
        "smoker",
        "campfire",
        "soul_campfire",
        "brewing_stand",
        "ender_chest",
        "flower_pot",
        "item_frame",
        "jukebox",
        "lectern",
        "shulker_box",
        "command_block",
        "repeating_command_block",
        "chain_command_block"
    ]

    if (forbiddenBlocks.some(forbiddenBlock => data.block.matches(forbiddenBlock))) {
        data.cancel = true;
    }
});

