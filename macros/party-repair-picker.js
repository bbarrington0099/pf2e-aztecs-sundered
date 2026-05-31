;(async () => {
   const MODULE_ID = "pf2e-aztecs-sundered"
   const moduleApi = game.modules.get(MODULE_ID)?.api
   if (!moduleApi?.launchRepairMacro) {
      return ui.notifications.error(
         "PF2e Aztec's Sundered API not found. Is the module active?",
      )
   }

   const { DialogV2 } = foundry.applications.api

   const toActor = (member) => {
      if (!member) return null
      if (member instanceof Actor) return member
      if (member.actor instanceof Actor) return member.actor
      const actorId = member.id || member.actorId || member.uuid
      if (!actorId || typeof actorId !== "string") return null
      if (actorId.startsWith("Actor.")) {
         return typeof fromUuidSync === "function"
            ? fromUuidSync(actorId)
            : game.actors.get(actorId.replace("Actor.", ""))
      }
      return game.actors.get(actorId)
   }

   const getPartyMembers = (partyActor) => {
      const membersField = partyActor.members ?? partyActor.system?.details?.members
      let rawMembers = []
      if (!membersField) return rawMembers
      if (Array.isArray(membersField)) rawMembers = membersField
      else if (typeof membersField.values === "function")
         rawMembers = [...membersField.values()]
      else if (typeof membersField === "object")
         rawMembers = Object.values(membersField)
      return rawMembers.map(toActor).filter((actor) => actor instanceof Actor)
   }

   const getItemDurability = (item) => {
      if (item.type === "shield") {
         const currentHp = Number(item.system?.hp?.value ?? 0)
         const maxHp = Number(item.system?.hp?.max ?? 0)
         const bt = Number(item.system?.hp?.brokenThreshold ?? Math.floor(maxHp / 2))
         return { currentHp, maxHp, bt }
      }
      const maxHpFlag = item.getFlag("world", "maxHp")
      const currentHpFlag = item.getFlag("world", "currentHp")
      if (maxHpFlag === undefined || currentHpFlag === undefined) return null
      const maxHp = Number(maxHpFlag)
      const bt = Math.floor(maxHp / 2)
      return {
         currentHp: Number(currentHpFlag),
         maxHp,
         bt,
      }
   }

   const isRepairableAndDamaged = (item) => {
      const durability = getItemDurability(item)
      if (!durability) return false
      if (!Number.isFinite(durability.maxHp) || durability.maxHp <= 0) return false
      return Number.isFinite(durability.currentHp) && durability.currentHp < durability.maxHp
   }

   const parties = game.actors.filter((actor) => actor.type === "party")
   if (parties.length === 0) {
      return ui.notifications.warn("No Party actors were found.")
   }

   const memberMap = new Map()
   for (const partyActor of parties) {
      for (const member of getPartyMembers(partyActor)) {
         memberMap.set(member.id, member)
      }
   }
   const members = [...memberMap.values()]
   if (members.length === 0) {
      return ui.notifications.warn("No party members were found on Party actors.")
   }

   const options = []
  const itemByUuid = new Map()
   for (const actor of members) {
      const items = actor.items.filter(isRepairableAndDamaged)
      for (const item of items) {
         const durability = getItemDurability(item)
         const damagePercent =
            durability.maxHp > 0
               ? ((durability.maxHp - durability.currentHp) / durability.maxHp) * 100
               : 0
         const isBroken =
            Number.isFinite(durability.bt) && durability.currentHp <= durability.bt
         const severityLabel = isBroken ? "broken" : "damaged"
        itemByUuid.set(item.uuid, item)
         options.push({
            value: item.uuid,
            label: `${actor.name}: ${item.name} (${durability.currentHp}/${durability.maxHp} HP, ${severityLabel}: ${Math.round(damagePercent)}%)`,
            damagePercent,
         })
      }
   }

   if (options.length === 0) {
      return ui.notifications.info("All tracked party items are at full HP.")
   }

   options.sort((a, b) => {
      if (b.damagePercent !== a.damagePercent) {
         return b.damagePercent - a.damagePercent
      }
      return a.label.localeCompare(b.label)
   })

   const optionsHtml = options
      .map(
         (option) =>
            `<option value="${option.value.replace(/"/g, "&quot;")}">${option.label.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</option>`,
      )
      .join("")

   const chosenUuid = await DialogV2.wait({
      window: { title: "Party Repair Picker" },
      content: `
         <form>
            <div class="form-group">
               <label>Damaged item</label>
               <select name="repair-item">${optionsHtml}</select>
            </div>
         </form>
      `,
      buttons: [
         {
            action: "repair",
            label: "Repair Selected",
            default: true,
            callback: (event, button, dialog) =>
               dialog.element.querySelector('select[name="repair-item"]')?.value ?? null,
         },
         {
            action: "cancel",
            label: game.i18n.localize("Cancel"),
         },
      ],
      rejectClose: false,
   })

   if (!chosenUuid) return
  const selectedTokenActor = canvas.tokens.controlled[0]?.actor || null
  const targetItem = itemByUuid.get(chosenUuid) || null

  let crafterActor = selectedTokenActor
  if (!crafterActor) {
     if (game.user.isGM) crafterActor = targetItem?.actor || null
     else {
        return ui.notifications.warn(
           "Select a token to choose which character performs the repair.",
        )
     }
  }

  await moduleApi.launchRepairMacro(chosenUuid, crafterActor)
})()
