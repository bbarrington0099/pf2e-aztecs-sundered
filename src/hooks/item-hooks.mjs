import { physicalTypes } from "../constants.mjs"
import {
   getDefaultDurability,
   applyNPCArmorPenalties,
   removeNPCArmorPenalties,
   applyNPCWeaponPenalties,
   removeNPCWeaponPenalties,
} from "../logic.mjs"
import { NpcPenaltyApp } from "../apps/npc-app.mjs"

const isRaiseShieldEffect = (effectItem) => {
   if (effectItem?.type !== "effect") return false
   const blob = JSON.stringify({
      name: effectItem.name,
      slug: effectItem.slug,
      sourceId: effectItem.sourceId,
      systemSlug: effectItem.system?.slug,
      rollOptions: effectItem.flags?.pf2e?.rollOptions,
   }).toLowerCase()

   return blob.includes("raise-a-shield") || blob.includes("raise a shield")
}

const getItemDurabilitySnapshot = (item, changes, options) => {
   const isShield = item.type === "shield"
   const defaultStats = getDefaultDurability(item)

   const oldMax = Number(
      options.aztecOldMax ??
         (isShield
            ? (item.system.hp?.max ?? 1)
            : (item.getFlag("world", "maxHp") ?? defaultStats.maxHp ?? 1)),
   )
   const oldHp = Number(
      options.aztecOldHp ??
         (isShield
            ? (item.system.hp?.value ?? 0)
            : (item.getFlag("world", "currentHp") ?? defaultStats.maxHp ?? 0)),
   )

   const newMax = Number(
      isShield
         ? (changes.system?.hp?.max ?? item.system.hp?.max ?? oldMax)
         : (changes.flags?.world?.maxHp ?? item.getFlag("world", "maxHp") ?? oldMax),
   )
   const newHp = Number(
      isShield
         ? (changes.system?.hp?.value ?? item.system.hp?.value ?? oldHp)
         : (changes.flags?.world?.currentHp ??
           item.getFlag("world", "currentHp") ??
           oldHp),
   )

   const oldThreshold = isShield
      ? Number(item.system.hp?.brokenThreshold ?? Math.floor(oldMax / 2))
      : Math.floor(oldMax / 2)
   const newThreshold = isShield
      ? Number(
           changes.system?.hp?.brokenThreshold ??
              item.system.hp?.brokenThreshold ??
              Math.floor(newMax / 2),
        )
      : Math.floor(newMax / 2)

   return { oldMax, oldHp, newMax, newHp, oldThreshold, newThreshold }
}

const removeLinkedBrokenEffects = async (item) => {
   if (!item.actor) return
   const linkedEffects = item.actor.items.filter(
      (effectItem) =>
         effectItem.type === "effect" &&
         effectItem.flags?.["pf2e-aztecs-sundered"]?.brokenItemId === item.id,
   )
   if (linkedEffects.length === 0) return
   await item.actor.deleteEmbeddedDocuments(
      "Item",
      linkedEffects.map((effectItem) => effectItem.id),
   )
}

export function registerItemHooks() {
   Hooks.on("preUpdateItem", (item, changes, options, userId) => {
      if (game.user.id !== userId) return

      if (changes.system && changes.system.containerId !== undefined) {
         if (changes.system.containerId !== null && item.actor) {
            let backpackContainer = item.actor.items.get(
               changes.system.containerId,
            )
            if (
               backpackContainer &&
               backpackContainer.type === "backpack" &&
               backpackContainer.getFlag("world", "maxHp") !== undefined
            ) {
               if (
                  (backpackContainer.getFlag("world", "currentHp") ?? 0) <=
                  Math.floor(backpackContainer.getFlag("world", "maxHp") / 2)
               ) {
                  ui.notifications.warn(
                     game.i18n.format(
                        "pf2e-aztecs-sundered.notifications.cant-stow",
                        { containerName: backpackContainer.name },
                     ),
                  )
                  delete changes.system.containerId
               }
            }
         }
      }

      if (!physicalTypes.includes(item.type)) return

      let isShield = item.type === "shield"
      let isDefaultType =
         item.type === "armor" || item.type === "weapon" || isShield
      let defaultDurabilityStats = getDefaultDurability(item)

      options.aztecOldMax = isShield
         ? (item.system.hp?.max ?? 1)
         : item.getFlag("world", "maxHp") ||
           (isDefaultType ? defaultDurabilityStats.maxHp : 1)

      options.aztecOldHp = isShield
         ? (item.system.hp?.value ?? 0)
         : (item.getFlag("world", "currentHp") ??
           (isDefaultType ? defaultDurabilityStats.maxHp : 0))

      let newMaximumHitPoints = isShield
         ? (changes.system?.hp?.max ?? options.aztecOldMax)
         : (changes.flags?.world?.maxHp ?? options.aztecOldMax)

      let newCurrentHitPoints = isShield
         ? (changes.system?.hp?.value ?? options.aztecOldHp)
         : (changes.flags?.world?.currentHp ?? options.aztecOldHp)

      if (newCurrentHitPoints > newMaximumHitPoints) {
         newCurrentHitPoints = newMaximumHitPoints
         if (isShield) {
            changes.system = changes.system || {}
            changes.system.hp = changes.system.hp || {}
            changes.system.hp.value = newMaximumHitPoints
         } else {
            changes.flags = changes.flags || {}
            changes.flags.world = changes.flags.world || {}
            changes.flags.world.currentHp = newMaximumHitPoints
         }
      }

      let brokenThreshold = isShield
         ? (item.system.hp?.brokenThreshold ??
           Math.floor(newMaximumHitPoints / 2))
         : Math.floor(newMaximumHitPoints / 2)
      let isBroken =
         newMaximumHitPoints > 0 && newCurrentHitPoints <= brokenThreshold

      if (
         newCurrentHitPoints === 0 &&
         (isDefaultType || item.getFlag("world", "maxHp") !== undefined)
      ) {
         if (changes.system?.equipped) {
            let newCarryType =
               changes.system.equipped.carryType ??
               item.system.equipped?.carryType
            if (
               !["dropped", "stowed", "worn"].includes(newCarryType) ||
               (changes.system.equipped.inSlot ??
                  item.system.equipped?.inSlot) === true
            ) {
               ui.notifications.warn(
                  game.i18n.format(
                     "pf2e-aztecs-sundered.notifications.cant-equip",
                     { itemName: item.name },
                  ),
               )
               delete changes.system.equipped
            }
         }
         if (options.aztecOldHp > 0) {
            changes.system = changes.system || {}
            changes.system.equipped = changes.system.equipped || {}
            Object.assign(changes.system.equipped, {
               carryType: "worn",
               inSlot: false,
               handsHeld: 0,
               invested: false,
            })
         }
      }

      if (item.actor?.type === "npc" || isShield) return

      let itemRules = foundry.utils.duplicate(item.system.rules || [])
      let rulesHaveChanged = false

      if (item.type === "armor") {
         let armorPenalty =
            item.system.category === "light"
               ? game.settings.get("pf2e-aztecs-sundered", "armourPenaltyLight")
               : item.system.category === "medium"
                 ? game.settings.get(
                      "pf2e-aztecs-sundered",
                      "armourPenaltyMedium",
                   )
                 : item.system.category === "heavy"
                   ? game.settings.get(
                        "pf2e-aztecs-sundered",
                        "armourPenaltyHeavy",
                     )
                   : 0

         if (item.system.traits?.value?.includes("laminar")) {
            armorPenalty = Math.min(
               0,
               armorPenalty -
                  game.settings.get(
                     "pf2e-aztecs-sundered",
                     "laminarPenaltyReduction",
                  ),
            )
         }

         let brokenArmorIndex = itemRules.findIndex(
            (rule) => rule.slug === "broken-armour-penalty",
         )

         if (
            isBroken &&
            game.settings.get("pf2e-aztecs-sundered", "enableArmourPenalty") &&
            armorPenalty !== 0
         ) {
            if (brokenArmorIndex === -1) {
               itemRules.push({
                  key: "FlatModifier",
                  selector: "ac",
                  value: armorPenalty,
                  slug: "broken-armour-penalty",
                  label: game.i18n.localize(
                     "pf2e-aztecs-sundered.rule-elements.broken.armor",
                  ),
               })
               rulesHaveChanged = true
            } else if (itemRules[brokenArmorIndex].value !== armorPenalty) {
               itemRules[brokenArmorIndex].value = armorPenalty
               rulesHaveChanged = true
            }
         } else if (brokenArmorIndex !== -1) {
            itemRules.splice(brokenArmorIndex, 1)
            rulesHaveChanged = true
         }
      }

      if (item.type === "weapon") {
         let weaponPenaltyAmount = game.settings.get(
            "pf2e-aztecs-sundered",
            "weaponPenaltyAmount",
         )
         let brokenAttackIndex = itemRules.findIndex(
            (rule) => rule.slug === "broken-weapon-attack",
         )
         let brokenDamageIndex = itemRules.findIndex(
            (rule) => rule.slug === "broken-weapon-damage",
         )

         if (
            isBroken &&
            game.settings.get("pf2e-aztecs-sundered", "enableWeaponPenalty") &&
            weaponPenaltyAmount !== 0
         ) {
            if (brokenAttackIndex === -1) {
               itemRules.push({
                  key: "FlatModifier",
                  selector: "attack",
                  type: "item",
                  value: weaponPenaltyAmount,
                  slug: "broken-weapon-attack",
                  label: game.i18n.localize(
                     "pf2e-aztecs-sundered.rule-elements.broken.weapon",
                  ),
               })
               rulesHaveChanged = true
            } else if (
               itemRules[brokenAttackIndex].value !== weaponPenaltyAmount
            ) {
               itemRules[brokenAttackIndex].value = weaponPenaltyAmount
               rulesHaveChanged = true
            }
            if (brokenDamageIndex === -1) {
               itemRules.push({
                  key: "FlatModifier",
                  selector: "damage",
                  type: "item",
                  value: weaponPenaltyAmount,
                  slug: "broken-weapon-damage",
                  label: game.i18n.localize(
                     "pf2e-aztecs-sundered.rule-elements.broken.weapon",
                  ),
               })
               rulesHaveChanged = true
            } else if (
               itemRules[brokenDamageIndex].value !== weaponPenaltyAmount
            ) {
               itemRules[brokenDamageIndex].value = weaponPenaltyAmount
               rulesHaveChanged = true
            }
         } else {
            if (brokenAttackIndex !== -1 || brokenDamageIndex !== -1) {
               ;[brokenDamageIndex, brokenAttackIndex]
                  .sort((a, b) => b - a)
                  .forEach((indexPosition) => {
                     if (indexPosition !== -1)
                        itemRules.splice(indexPosition, 1)
                  })
               rulesHaveChanged = true
            }
         }
      }

      if (rulesHaveChanged) {
         changes.system = changes.system || {}
         changes.system.rules = itemRules
      }

      let runesBackup = item.getFlag("world", "runesBackup")
      if (isBroken) {
         if (!runesBackup) {
            runesBackup = foundry.utils.duplicate(item.system.runes || {})
            changes.flags = changes.flags || {}
            changes.flags.world = changes.flags.world || {}
            changes.flags.world.runesBackup = runesBackup
         }
         let desiredRunes = foundry.utils.duplicate(runesBackup)

         if (item.type === "armor") {
            if (
               game.settings.get(
                  "pf2e-aztecs-sundered",
                  "suppressArmourPotency",
               )
            ) {
               desiredRunes.potency = 0
               desiredRunes.resilient = 0
               desiredRunes.property = []
            } else {
               if (
                  game.settings.get(
                     "pf2e-aztecs-sundered",
                     "suppressArmourResilient",
                  )
               )
                  desiredRunes.resilient = 0
               if (
                  game.settings.get(
                     "pf2e-aztecs-sundered",
                     "suppressArmourProperty",
                  )
               )
                  desiredRunes.property = []
            }
         } else if (item.type === "weapon") {
            if (
               game.settings.get(
                  "pf2e-aztecs-sundered",
                  "suppressWeaponPotency",
               )
            ) {
               desiredRunes.potency = 0
               desiredRunes.striking = 0
               desiredRunes.property = []
            } else {
               if (
                  game.settings.get(
                     "pf2e-aztecs-sundered",
                     "suppressWeaponStriking",
                  )
               )
                  desiredRunes.striking = 0
               if (
                  game.settings.get(
                     "pf2e-aztecs-sundered",
                     "suppressWeaponProperty",
                  )
               )
                  desiredRunes.property = []
            }
         }
         changes.system = changes.system || {}
         changes.system.runes = desiredRunes
      } else if (
         options.aztecOldMax > 0 &&
         options.aztecOldHp <=
            (isShield
               ? (item.system.hp?.brokenThreshold ??
                 Math.floor(options.aztecOldMax / 2))
               : Math.floor(options.aztecOldMax / 2)) &&
         !isBroken &&
         runesBackup
      ) {
         changes.system = changes.system || {}
         changes.system.runes = foundry.utils.duplicate(runesBackup)
         changes.flags = changes.flags || {}
         changes.flags.world = changes.flags.world || {}
         changes.flags.world["-=runesBackup"] = null
      }
   })

   Hooks.on("updateItem", async (item, changes, options, userId) => {
      if (game.user.id !== userId) return

      if (
         item.type === "backpack" &&
         item.actor &&
         options.aztecOldHp > 0 &&
         (changes.flags?.world?.currentHp ??
            item.getFlag("world", "currentHp")) <= 0
      ) {
         const backpackContents = item.actor.items.filter(
            (i) => i.system.containerId === item.id,
         )
         if (backpackContents.length > 0)
            await item.actor.updateEmbeddedDocuments(
               "Item",
               backpackContents.map((containedItem) => ({
                  _id: containedItem.id,
                  "system.containerId": null,
                  "system.equipped.carryType": "dropped",
               })),
            )
      }

      if (
         item.actor &&
         (item.type === "armor" || item.type === "weapon" || item.type === "shield")
      ) {
         const { oldMax, oldHp, newMax, newHp, oldThreshold, newThreshold } =
            getItemDurabilitySnapshot(item, changes, options)

         const wasBroken = oldMax > 0 && oldHp <= oldThreshold
         const isBroken = newMax > 0 && newHp <= newThreshold
         if (wasBroken && !isBroken) {
            await removeLinkedBrokenEffects(item)
         }
      }

      if (item.type === "shield" && item.actor) {
         const oldMaxHp = Number(options.aztecOldMax ?? item.system.hp?.max ?? 0)
         const oldHp = Number(options.aztecOldHp ?? item.system.hp?.value ?? 0)
         const oldBrokenThreshold =
            item.system.hp?.brokenThreshold ?? Math.floor(oldMaxHp / 2)

         const newMaxHp = Number(changes.system?.hp?.max ?? item.system.hp?.max ?? oldMaxHp)
         const newHp = Number(changes.system?.hp?.value ?? item.system.hp?.value ?? oldHp)
         const newBrokenThreshold =
            changes.system?.hp?.brokenThreshold ??
            item.system.hp?.brokenThreshold ??
            Math.floor(newMaxHp / 2)

         const wasBroken = oldMaxHp > 0 && oldHp <= oldBrokenThreshold
         const isBroken = newMaxHp > 0 && newHp <= newBrokenThreshold

         if (!wasBroken && isBroken) {
            const raiseShieldEffects = item.actor.items.filter(isRaiseShieldEffect)
            if (raiseShieldEffects.length > 0) {
               await item.actor.deleteEmbeddedDocuments(
                  "Item",
                  raiseShieldEffects.map((effectItem) => effectItem.id),
               )
            }
         }
      }

      if (item.type !== "armor" && item.type !== "weapon") return

      let expandedChanges = foundry.utils.expandObject(changes)
      if (
         expandedChanges.system?.material !== undefined ||
         expandedChanges.flags?.world?.usePreciousMaterial !== undefined ||
         expandedChanges.system?.baseItem !== undefined ||
         expandedChanges.flags?.world?.assignedMaterial !== undefined
      ) {
         let defaultDurabilityStats = getDefaultDurability(item)
         let oldMaximumHp = options.aztecOldMax || 1
         let newCurrentHp = Math.max(
            0,
            Math.round(
               ((item.getFlag("world", "currentHp") ??
                  defaultDurabilityStats.maxHp) /
                  oldMaximumHp) *
                  defaultDurabilityStats.maxHp,
            ),
         )
         if (
            item.getFlag("world", "maxHp") !== defaultDurabilityStats.maxHp ||
            item.getFlag("world", "hardness") !==
               defaultDurabilityStats.hardness
         ) {
            await item.update({
               "flags.world.maxHp": defaultDurabilityStats.maxHp,
               "flags.world.currentHp": isNaN(newCurrentHp)
                  ? defaultDurabilityStats.maxHp
                  : newCurrentHp,
               "flags.world.hardness": defaultDurabilityStats.hardness,
            })
         }
      }

      if (item.actor?.type === "npc") {
         let isDefaultType = item.type === "armor" || item.type === "weapon"
         let defaultDurabilityStats = getDefaultDurability(item)
         let oldMaximumHp =
            options.aztecOldMax ??
            (isDefaultType ? defaultDurabilityStats.maxHp : 1)
         let oldCurrentHp =
            options.aztecOldHp ??
            (isDefaultType ? defaultDurabilityStats.maxHp : 0)
         let newMaximumHp =
            changes.flags?.world?.maxHp ??
            item.getFlag("world", "maxHp") ??
            oldMaximumHp
         let newCurrentHp =
            changes.flags?.world?.currentHp ??
            item.getFlag("world", "currentHp") ??
            oldCurrentHp

         const processNPCChoices = async (npcChoices) => {
            if (!npcChoices) return
            if (item.type === "armor") {
               await removeNPCArmorPenalties(item)
               await applyNPCArmorPenalties(item, npcChoices)
            }
            if (item.type === "weapon") {
               await removeNPCWeaponPenalties(item)
               await applyNPCWeaponPenalties(item, npcChoices)
            }
         }

         if (
            oldMaximumHp > 0 &&
            oldCurrentHp > 0 &&
            newMaximumHp > 0 &&
            newCurrentHp <= 0
         ) {
            new NpcPenaltyApp({
               item,
               isDestroyed: true,
               resolve: processNPCChoices,
            }).render(true)
         } else if (
            oldMaximumHp > 0 &&
            oldCurrentHp > Math.floor(oldMaximumHp / 2) &&
            newMaximumHp > 0 &&
            newCurrentHp <= Math.floor(newMaximumHp / 2)
         ) {
            new NpcPenaltyApp({
               item,
               isDestroyed: false,
               resolve: processNPCChoices,
            }).render(true)
         } else if (
            oldMaximumHp > 0 &&
            oldCurrentHp <= Math.floor(oldMaximumHp / 2) &&
            newCurrentHp > Math.floor(newMaximumHp / 2)
         ) {
            if (item.type === "armor") await removeNPCArmorPenalties(item)
            if (item.type === "weapon") await removeNPCWeaponPenalties(item)
         }
      }
   })
}
