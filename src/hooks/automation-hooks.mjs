import { getDefaultDurability } from "../logic.mjs"

const MODULE_ID = "pf2e-aztecs-sundered"

const getActorHpValues = (actor, expandedChanges = {}) => {
   const oldHp = Number(actor.system?.attributes?.hp?.value ?? 0)
   const maxHp = Number(actor.system?.attributes?.hp?.max ?? 0)
   const changedHp = expandedChanges.system?.attributes?.hp?.value
   const newHp = Number(changedHp ?? oldHp)
   return { oldHp, newHp, maxHp }
}

const shouldRunForActor = (actor, pcSettingKey, npcSettingKey) => {
   if (!actor) return false
   if (actor.type === "npc") {
      return game.settings.get(MODULE_ID, npcSettingKey)
   }
   if (actor.type === "character") {
      return game.settings.get(MODULE_ID, pcSettingKey)
   }
   return false
}

const getEquippedArmor = (actor) =>
   actor.items.find(
      (item) =>
         item.type === "armor" &&
         item.system?.equipped?.inSlot === true &&
         item.system?.equipped?.carryType === "worn",
   )

const getWeaponDurabilityState = (weapon) => {
   const defaults = getDefaultDurability(weapon)
   const maxHp = Number(weapon.getFlag("world", "maxHp") ?? defaults.maxHp)
   const currentHp = Number(
      weapon.getFlag("world", "currentHp") ?? defaults.maxHp,
   )
   const hardness = Number(
      weapon.getFlag("world", "hardness") ?? defaults.hardness ?? 0,
   )
   return { maxHp, currentHp, hardness, defaults }
}

const getArmorDurabilityState = (armor) => {
   const defaults = getDefaultDurability(armor)
   const maxHp = Number(armor.getFlag("world", "maxHp") ?? defaults.maxHp)
   const currentHp = Number(armor.getFlag("world", "currentHp") ?? defaults.maxHp)
   const hardness = Number(
      armor.getFlag("world", "hardness") ?? defaults.hardness ?? 0,
   )
   return { maxHp, currentHp, hardness, defaults }
}

const postAutomationMessage = (content) => {
   if (!game.settings.get(MODULE_ID, "showDurabilityAutoMessages")) return
   ChatMessage.create({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ user: game.user }),
      content,
   })
}

const applyDamageToWeapon = async (weapon, rawDamage) => {
   const { maxHp, currentHp, hardness, defaults } = getWeaponDurabilityState(
      weapon,
   )
   const overflowDamage = Math.max(0, rawDamage - hardness)
   if (overflowDamage <= 0) {
      postAutomationMessage(
         game.i18n.format(
            "pf2e-aztecs-sundered.chat.automation.weapon.no-damage",
            {
               itemName: weapon.name,
               rawDamage,
               hardness,
            },
         ),
      )
      return
   }

   const newHp = Math.max(0, currentHp - overflowDamage)
   const updates = {
      "flags.world.currentHp": newHp,
   }
   if (weapon.getFlag("world", "maxHp") === undefined) {
      updates["flags.world.maxHp"] = defaults.maxHp
   }
   if (weapon.getFlag("world", "hardness") === undefined) {
      updates["flags.world.hardness"] = defaults.hardness
   }
   await weapon.update(updates)

   postAutomationMessage(
      game.i18n.format("pf2e-aztecs-sundered.chat.automation.weapon.damage", {
         itemName: weapon.name,
         rawDamage,
         hardness,
         damage: overflowDamage,
         currentHp: newHp,
         maxHp,
      }),
   )
}

const applyDamageToArmor = async (armor, rawDamage, thresholdPercent) => {
   const { maxHp, currentHp, hardness, defaults } = getArmorDurabilityState(armor)
   const overflowDamage = Math.max(0, rawDamage - hardness)
   if (overflowDamage <= 0) {
      postAutomationMessage(
         game.i18n.format("pf2e-aztecs-sundered.chat.automation.armor.no-damage", {
            itemName: armor.name,
            rawDamage,
            hardness,
            threshold: thresholdPercent,
         }),
      )
      return
   }

   const newHp = Math.max(0, currentHp - overflowDamage)
   const updates = {
      "flags.world.currentHp": newHp,
   }
   if (armor.getFlag("world", "maxHp") === undefined) {
      updates["flags.world.maxHp"] = defaults.maxHp
   }
   if (armor.getFlag("world", "hardness") === undefined) {
      updates["flags.world.hardness"] = defaults.hardness
   }
   await armor.update(updates)

   postAutomationMessage(
      game.i18n.format("pf2e-aztecs-sundered.chat.automation.armor.damage", {
         itemName: armor.name,
         rawDamage,
         hardness,
         damage: overflowDamage,
         currentHp: newHp,
         maxHp,
         threshold: thresholdPercent,
      }),
   )
}

const getActorFromMessage = (message) => {
   if (message.actor) return message.actor
   const speakerActorId = message.speaker?.actor
   if (speakerActorId) {
      const foundActor = game.actors.get(speakerActorId)
      if (foundActor) return foundActor
   }
   const speakerTokenId = message.speaker?.token
   if (speakerTokenId) {
      const tokenActor = canvas.tokens?.get(speakerTokenId)?.actor
      if (tokenActor) return tokenActor
   }
   return null
}

const isCriticalFailAttackMessage = (message) => {
   const context = message.flags?.pf2e?.context || {}
   const options = context.options || []
   const normalizedOptions = options.map((entry) => String(entry).toLowerCase())
   const flavor = String(message.flavor || "").toLowerCase()

   const isAttackRoll =
      context.type === "attack-roll" ||
      normalizedOptions.includes("check:type:attack-roll") ||
      normalizedOptions.includes("action:strike") ||
      flavor.includes("attack roll")
   const isCriticalFailure =
      context.outcome === "criticalFailure" ||
      context.outcome === "critical-failure" ||
      context.degreeOfSuccess === 0 ||
      normalizedOptions.includes("degree:critical-failure") ||
      flavor.includes("critical failure")

   return isAttackRoll && isCriticalFailure
}

const promptForCritFailDamage = async (weaponName) => {
   const response = window.prompt(
      game.i18n.format(
         "pf2e-aztecs-sundered.dialog.automation.weapon-prompt-body",
         { weaponName },
      ),
      "0",
   )
   if (response === null) return null
   const parsed = Number.parseInt(response, 10)
   if (!Number.isFinite(parsed) || parsed <= 0) return null
   return parsed
}

export function registerAutomationHooks() {
   Hooks.on("renderChatMessageHTML", (message, htmlElement) => {
      if (!isCriticalFailAttackMessage(message)) return

      const actor = getActorFromMessage(message)
      if (
         !shouldRunForActor(
            actor,
            "enableCritFailWeaponDamagePC",
            "enableCritFailWeaponDamageNPC",
         )
      ) {
         return
      }

      const weapon = message.item?.type === "weapon" ? message.item : null
      if (!weapon) return

      const domElement =
         htmlElement instanceof HTMLElement ? htmlElement : htmlElement[0]
      if (!domElement || domElement.querySelector(".aztec-critfail-weapon-btn")) {
         return
      }

      const buttonHtml = `
         <button type="button" class="aztec-critfail-weapon-btn" title="${game.i18n.localize("pf2e-aztecs-sundered.dialog.automation.weapon-prompt-title")}">
            <i class="fa-solid fa-triangle-exclamation fa-fw" inert=""></i>
            <span class="label">${game.i18n.localize("pf2e-aztecs-sundered.dialog.automation.weapon-prompt-button")}</span>
         </button>
      `

      const damageAppContainer = domElement.querySelector(".damage-application")
      if (damageAppContainer) {
         damageAppContainer.insertAdjacentHTML("beforeend", buttonHtml)
      } else {
         const messageContent = domElement.querySelector(".message-content")
         if (messageContent) {
            messageContent.insertAdjacentHTML("beforeend", buttonHtml)
         }
      }

      domElement.addEventListener(
         "click",
         async (event) => {
            const button = event.target.closest(".aztec-critfail-weapon-btn")
            if (!button) return
            event.preventDefault()
            event.stopPropagation()

            const rawDamage = await promptForCritFailDamage(weapon.name)
            if (!rawDamage) return
            await applyDamageToWeapon(weapon, rawDamage)
         },
         true,
      )
   })

   Hooks.on("updateActor", async (actor, changes, options, userId) => {
      if (game.user.id !== userId) return
      if (
         !shouldRunForActor(
            actor,
            "enableArmorDamageFromHpPC",
            "enableArmorDamageFromHpNPC",
         )
      ) {
         return
      }

      const expandedChanges = foundry.utils.expandObject(changes)
      if (expandedChanges.system?.attributes?.hp?.value === undefined) return

      const oldHp = Number(options.aztecOldActorHp ?? actor.system?.attributes?.hp?.value)
      const { newHp, maxHp } = getActorHpValues(actor, expandedChanges)
      if (maxHp <= 0 || !Number.isFinite(oldHp) || !Number.isFinite(newHp)) return

      const hpDamageTaken = Math.max(0, oldHp - newHp)
      if (hpDamageTaken <= 0) return

      const armor = getEquippedArmor(actor)
      if (!armor) return

      const isNpc = actor.type === "npc"
      const useStaminaMode =
         !isNpc && game.settings.get(MODULE_ID, "armorDamageUseStaminaForPC")
      const thresholdPercent = isNpc
         ? game.settings.get(MODULE_ID, "armorDamageThresholdNPC")
         : game.settings.get(MODULE_ID, "armorDamageThresholdPC")

      let armorRawDamage = hpDamageTaken
      if (!useStaminaMode) {
         const thresholdHp = Math.floor((maxHp * thresholdPercent) / 100)
         if (oldHp > thresholdHp) {
            armorRawDamage = Math.max(0, thresholdHp - newHp)
         }
      }

      if (armorRawDamage <= 0) return
      await applyDamageToArmor(armor, armorRawDamage, thresholdPercent)
   })

   Hooks.on("preUpdateActor", (actor, changes, options, userId) => {
      if (game.user.id !== userId) return
      const expandedChanges = foundry.utils.expandObject(changes)
      if (expandedChanges.system?.attributes?.hp?.value === undefined) return
      options.aztecOldActorHp = Number(actor.system?.attributes?.hp?.value ?? 0)
   })
}
