import { getDefaultDurability } from "../logic.mjs"

const MODULE_ID = "pf2e-aztecs-sundered"
const { DialogV2 } = foundry.applications.api

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

const getEquippedArmor = (actor) => {
   const armorItems = actor.items.filter((item) => item.type === "armor")
   if (armorItems.length === 0) return null

   const strictSlotArmor = armorItems.find(
      (item) =>
         item.system?.equipped?.inSlot === true &&
         item.system?.equipped?.carryType === "worn",
   )
   if (strictSlotArmor) return strictSlotArmor

   const wornArmor = armorItems.find(
      (item) =>
         item.system?.equipped?.carryType === "worn" ||
         item.system?.equipped?.equipped === true,
   )
   if (wornArmor) return wornArmor

   return armorItems[0] || null
}

const isShieldEquipped = (shield) => {
   const carryType = shield.system?.equipped?.carryType
   return carryType === "held" || carryType === "worn"
}

const getRaisedShield = (actor) => {
   const equippedShields = actor.items.filter(
      (item) => item.type === "shield" && isShieldEquipped(item),
   )
   if (equippedShields.length === 0) return null

   const shieldData = actor.system?.attributes?.shield || {}
   const preferredShieldId = shieldData.itemId || shieldData.id || null
   const raisedFlag = shieldData.raised

   if (preferredShieldId) {
      const preferredShield = equippedShields.find(
         (shield) => shield.id === preferredShieldId,
      )
      if (preferredShield && (raisedFlag === true || raisedFlag === preferredShield.id))
         return preferredShield
   }

   const directRaised = equippedShields.find(
      (shield) => raisedFlag === shield.id || shield.system?.raised === true,
   )
   if (directRaised) return directRaised

   if (raisedFlag === true) return equippedShields[0] || null
   return null
}

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

const postAutomationMessage = async (content) => {
   if (!game.settings.get(MODULE_ID, "showDurabilityAutoMessages")) return
   await ChatMessage.create({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ user: game.user }),
      content,
   })
}

const getWeaponBreakageFormula = (weapon) => {
   const damageData = weapon.system?.damage || {}
   const baseDice = Math.max(1, Number(damageData.dice ?? 1))
   const die = String(damageData.die || "d4")
   const modifier = Number(damageData.modifier ?? 0)
   const striking = Math.max(0, Number(weapon.system?.runes?.striking ?? 0))
   const totalDice = baseDice + striking

   if (die.startsWith("d")) {
      const modPart = modifier > 0 ? `+${modifier}` : modifier < 0 ? `${modifier}` : ""
      return `${totalDice}${die}${modPart}`
   }

   const damageRolls = weapon.system?.damageRolls
   if (damageRolls && typeof damageRolls === "object") {
      const firstRoll = Object.values(damageRolls).find(
         (entry) => typeof entry?.damage === "string" && entry.damage.trim(),
      )
      if (firstRoll?.damage) return String(firstRoll.damage)
   }

   return null
}

const rollWeaponBreakageDamage = async (weapon, actor) => {
   const formula = getWeaponBreakageFormula(weapon)
   if (!formula) {
      ui.notifications.warn(
         game.i18n.format(
            "pf2e-aztecs-sundered.notifications.weapon-breakage-no-formula",
            {
               itemName: weapon.name,
            },
         ),
      )
      return null
   }

   const rollData = actor?.getRollData?.() ?? {}
   const roll = await new Roll(formula, rollData).evaluate()
   await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: actor || null }),
      flavor: game.i18n.format(
         "pf2e-aztecs-sundered.chat.automation.weapon-breakage-roll",
         {
            itemName: weapon.name,
            formula,
         },
      ),
   })

   return roll.total
}

const applyDamageToWeapon = async (weapon, rawDamage) => {
   const { maxHp, currentHp, hardness, defaults } = getWeaponDurabilityState(
      weapon,
   )
   const overflowDamage = Math.max(0, rawDamage - hardness)
   if (overflowDamage <= 0) {
      await postAutomationMessage(
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

   await postAutomationMessage(
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
      await postAutomationMessage(
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

   await postAutomationMessage(
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

const applyShieldBlockDamage = async (actor, shield, incomingDamage) => {
   const shieldCurrentHp = Number(shield.system?.hp?.value ?? 0)
   const shieldMaxHp = Number(shield.system?.hp?.max ?? 0)
   const shieldHardness = Number(shield.system?.hardness ?? 0)
   const actorCurrentHp = Number(actor.system?.attributes?.hp?.value ?? 0)

   const postHardnessDamage = Math.max(0, incomingDamage - shieldHardness)
   const newShieldHp = Math.max(0, shieldCurrentHp - postHardnessDamage)
   const newActorHp = Math.max(0, actorCurrentHp - postHardnessDamage)

   await shield.update({ "system.hp.value": newShieldHp })
   await actor.update({ "system.attributes.hp.value": newActorHp })

   await postAutomationMessage(
      game.i18n.format("pf2e-aztecs-sundered.chat.automation.shield-block.content", {
         actorName: actor.name,
         itemName: shield.name,
         incomingDamage,
         hardness: shieldHardness,
         shieldDamage: postHardnessDamage,
         actorDamage: postHardnessDamage,
         shieldCurrentHp: newShieldHp,
         shieldMaxHp,
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

const getWeaponFromMessage = (message, actor) => {
   if (message.item?.type === "weapon") return message.item

   const context = message.flags?.pf2e?.context || {}
   const options = (context.options || []).map((entry) => String(entry))
   for (const option of options) {
      const idMatch = option.match(/^item:id:(.+)$/i)
      if (idMatch?.[1]) {
         const item = actor?.items?.get(idMatch[1])
         if (item?.type === "weapon") return item
      }
   }

   const actorWeapon = actor?.items?.find(
      (item) =>
         item.type === "weapon" &&
         item.system?.equipped?.carryType !== "stowed" &&
         item.system?.equipped?.inSlot !== false,
   )
   if (actorWeapon) return actorWeapon

   return null
}

const isCriticalFailAttackMessage = (message) => {
   const context = message.flags?.pf2e?.context || {}
   const options = context.options || []
   const normalizedOptions = options.map((entry) => String(entry).toLowerCase())
   const flavor = String(message.flavor || "").toLowerCase()
   const contextType = String(context.type || "").toLowerCase()
   const modifierName = String(context.modifierName || "").toLowerCase()
   const contextSummary = JSON.stringify(context).toLowerCase()
   const hasStrikeStatistic = normalizedOptions.some(
      (entry) =>
         entry.startsWith("check:statistic:") &&
         (entry.includes("strike") || entry.includes("attack")),
   )

   const isAttackRoll =
      contextType === "attack-roll" ||
      contextType.includes("attack") ||
      contextType.includes("strike") ||
      normalizedOptions.includes("check:type:attack-roll") ||
      normalizedOptions.includes("action:strike") ||
      hasStrikeStatistic ||
      normalizedOptions.some((entry) => entry.includes("action:strike")) ||
      normalizedOptions.some((entry) => entry.includes("attack")) ||
      message.item?.type === "weapon" ||
      modifierName.includes("strike") ||
      modifierName.includes("attack") ||
      contextSummary.includes("action:strike") ||
      flavor.includes("attack roll")

   const isCriticalFailure =
      context.outcome === "criticalFailure" ||
      context.outcome === "critical-failure" ||
      context.degreeOfSuccess === 0 ||
      context.degreeOfSuccess === "criticalFailure" ||
      context.degreeOfSuccess === "critical-failure" ||
      normalizedOptions.includes("degree:critical-failure") ||
      contextSummary.includes("criticalfailure") ||
      contextSummary.includes("critical-failure") ||
      flavor.includes("critical failure")

   return isAttackRoll && isCriticalFailure
}

const isShieldBlockMessage = (message) => {
   const context = message.flags?.pf2e?.context || {}
   const options = (context.options || []).map((entry) =>
      String(entry).toLowerCase(),
   )
   const itemSlug = String(message.item?.slug || "").toLowerCase()
   const itemName = String(message.item?.name || "").toLowerCase()
   const flavor = String(message.flavor || "").toLowerCase()
   return (
      options.includes("action:shield-block") ||
      itemSlug === "shield-block" ||
      itemName.includes("shield block") ||
      flavor.includes("shield block")
   )
}

const promptForNumber = async ({ title, body, defaultValue = 0 }) => {
   const content = `
      <form>
         <div class="form-group">
            <label>${body}</label>
            <input type="number" name="aztec-value" value="${defaultValue}" min="0" step="1" />
         </div>
      </form>
   `
   const result = await DialogV2.wait({
      window: { title },
      content,
      buttons: [
         {
            action: "confirm",
            label: game.i18n.localize("PF2E.Actor.ApplyDamage"),
            default: true,
            callback: (event, button, dialog) => {
               const input = dialog.element.querySelector('input[name="aztec-value"]')
               return input?.value ?? null
            },
         },
         {
            action: "cancel",
            label: game.i18n.localize("Cancel"),
         },
      ],
      rejectClose: false,
   })
   if (result === null || result === undefined || result === "") return null
   const parsed = Number.parseInt(String(result), 10)
   if (!Number.isFinite(parsed) || parsed <= 0) return null
   return parsed
}

const promptYesNo = async ({ title, body }) => {
   const confirmed = await DialogV2.confirm({
      window: { title },
      content: `<p>${body}</p>`,
      yes: {
         label: game.i18n.localize("Yes"),
      },
      no: {
         label: game.i18n.localize("No"),
      },
      rejectClose: false,
   })
   return confirmed === true
}

const promptForShieldBlockIncomingDamage = async (actorName, shieldName) => {
   return promptForNumber({
      title: game.i18n.localize(
         "pf2e-aztecs-sundered.dialog.automation.shield-block-prompt-title",
      ),
      body: game.i18n.format(
         "pf2e-aztecs-sundered.dialog.automation.shield-block-prompt-body",
         { actorName, shieldName },
      ),
      defaultValue: 0,
   })
}

const shouldArmorAutomationApplyForThisHit = async (
   actor,
   changes,
   options,
   hpDamageTaken,
) =>
   promptYesNo({
      title: game.i18n.localize(
         "pf2e-aztecs-sundered.dialog.automation.armor-physical-prompt-title",
      ),
      body: game.i18n.format(
         "pf2e-aztecs-sundered.dialog.automation.armor-physical-prompt",
         { actorName: actor.name, damage: hpDamageTaken },
      ),
   })

const resolveActor = (actorOrId) => {
   if (!actorOrId) return null
   if (typeof actorOrId === "string") return game.actors.get(actorOrId) || null
   return actorOrId
}

export const runShieldBlockAutomation = async (actorOrId, incomingDamage) => {
   const actor = resolveActor(actorOrId)
   if (!actor) return false
   const incoming = Number(incomingDamage)
   if (!Number.isFinite(incoming) || incoming <= 0) return false

   const shield = getRaisedShield(actor)
   if (!shield) {
      ui.notifications.warn(
         game.i18n.format(
            "pf2e-aztecs-sundered.notifications.no-raised-shield",
            {
               actorName: actor.name,
            },
         ),
      )
      return false
   }

   await applyShieldBlockDamage(actor, shield, incoming)
   return true
}

export const promptAndRunShieldBlockAutomation = async (actorOrId) => {
   const actor = resolveActor(actorOrId)
   if (!actor) return false

   const shield = getRaisedShield(actor)
   if (!shield) {
      ui.notifications.warn(
         game.i18n.format(
            "pf2e-aztecs-sundered.notifications.no-raised-shield",
            {
               actorName: actor.name,
            },
         ),
      )
      return false
   }

   const incomingDamage = await promptForShieldBlockIncomingDamage(
      actor.name,
      shield.name,
   )
   if (!incomingDamage) return false
   await applyShieldBlockDamage(actor, shield, incomingDamage)
   return true
}

export function registerAutomationHooks() {
   Hooks.on("renderChatMessageHTML", (message, htmlElement) => {
      if (!game.user.isGM) return
      const domElement =
         htmlElement instanceof HTMLElement ? htmlElement : htmlElement[0]
      if (!domElement) return

      if (isCriticalFailAttackMessage(message)) {
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

         const weapon = getWeaponFromMessage(message, actor)
         if (!weapon) return

         if (!domElement.querySelector(".aztec-critfail-weapon-btn")) {
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
         }

      }

      if (isShieldBlockMessage(message)) {
         const actor = getActorFromMessage(message)
         if (
            !shouldRunForActor(actor, "shieldBlockAutoPC", "shieldBlockAutoNPC")
         ) {
            return
         }

         if (domElement.querySelector(".aztec-shield-block-btn")) return

         const buttonHtml = `
            <button type="button" class="aztec-shield-block-btn" title="${game.i18n.localize("pf2e-aztecs-sundered.dialog.automation.shield-block-prompt-title")}">
               <i class="fa-solid fa-shield-halved fa-fw" inert=""></i>
               <span class="label">${game.i18n.localize("pf2e-aztecs-sundered.dialog.automation.shield-block-prompt-button")}</span>
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
      }

      domElement.addEventListener(
         "click",
         async (event) => {
            const button = event.target.closest(".aztec-critfail-weapon-btn")
            if (button) {
               event.preventDefault()
               event.stopPropagation()
               const actor = getActorFromMessage(message)
               const weapon = getWeaponFromMessage(message, actor)
               if (!weapon) return
               const rawDamage = await rollWeaponBreakageDamage(weapon, actor)
               if (!rawDamage) return
               await applyDamageToWeapon(weapon, rawDamage)
               return
            }

            const shieldButton = event.target.closest(".aztec-shield-block-btn")
            if (!shieldButton) return
            event.preventDefault()
            event.stopPropagation()

            const actor = getActorFromMessage(message)
            if (!actor) return
            await promptAndRunShieldBlockAutomation(actor)
         },
         true,
      )
   })

   Hooks.on("updateActor", async (actor, changes, options, userId) => {
      if (!game.user.isGM) return
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
      if (
         !(await shouldArmorAutomationApplyForThisHit(
            actor,
            changes,
            options,
            hpDamageTaken,
         ))
      )
         return

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
      if (!game.user.isGM) return
      const expandedChanges = foundry.utils.expandObject(changes)
      if (expandedChanges.system?.attributes?.hp?.value === undefined) return
      options.aztecOldActorHp = Number(actor.system?.attributes?.hp?.value ?? 0)
   })
}
