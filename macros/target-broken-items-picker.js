;(async () => {
   const MODULE_ID = "pf2e-aztecs-sundered"
   const moduleApi = game.modules.get(MODULE_ID)?.api
   if (!moduleApi?.launchRepairMacro) {
      return ui.notifications.error(
         "PF2e Aztec's Sundered API not found. Is the module active?",
      )
   }

   const { DialogV2 } = foundry.applications.api

   const token = [...game.user.targets][0] || canvas.tokens.controlled[0] || null
   const actor = token?.actor || null
   if (!actor) {
      return ui.notifications.warn(
         "Target a token first (or control one token) to list broken items.",
      )
   }

   const getDurabilityState = (item) => {
      if (item.type === "shield") {
         const currentHp = Number(item.system?.hp?.value ?? 0)
         const maxHp = Number(item.system?.hp?.max ?? 0)
         const bt = Number(item.system?.hp?.brokenThreshold ?? Math.floor(maxHp / 2))
         return { currentHp, maxHp, bt }
      }

      if (item.type === "armor" || item.type === "weapon") {
         const maxHp = Number(item.getFlag("world", "maxHp") ?? 10)
         const currentHp = Number(item.getFlag("world", "currentHp") ?? maxHp)
         const bt = Math.floor(maxHp / 2)
         return { currentHp, maxHp, bt }
      }

      const maxHpFlag = item.getFlag("world", "maxHp")
      const currentHpFlag = item.getFlag("world", "currentHp")
      if (maxHpFlag === undefined || currentHpFlag === undefined) return null
      const maxHp = Number(maxHpFlag)
      const currentHp = Number(currentHpFlag)
      const bt = Math.floor(maxHp / 2)
      return { currentHp, maxHp, bt }
   }

   const isRepairableAndDamaged = (item) => {
      const state = getDurabilityState(item)
      if (!state) return false
      if (!Number.isFinite(state.maxHp) || state.maxHp <= 0) return false
      return Number.isFinite(state.currentHp) && state.currentHp < state.maxHp
   }

   const candidates = actor.items
      .filter(isRepairableAndDamaged)
      .map((item) => {
         const state = getDurabilityState(item)
         const damagePercent =
            state.maxHp > 0
               ? ((state.maxHp - state.currentHp) / state.maxHp) * 100
               : 0
         const status =
            state.currentHp <= 0
               ? game.i18n.localize("pf2e-aztecs-sundered.status.destroyed")
               : state.currentHp <= state.bt
                 ? game.i18n.localize("pf2e-aztecs-sundered.status.broken")
                 : game.i18n.localize("pf2e-aztecs-sundered.status.damaged")
         const severityLabel = state.currentHp <= state.bt ? "broken" : "damaged"
         return {
            value: item.uuid,
            label: `${item.name} (${state.currentHp}/${state.maxHp} HP, BT ${state.bt}, ${severityLabel}: ${Math.round(damagePercent)}%) - ${status}`,
            damagePercent,
         }
      })
      .sort((a, b) => {
         if (b.damagePercent !== a.damagePercent) {
            return b.damagePercent - a.damagePercent
         }
         return a.label.localeCompare(b.label)
      })
   const itemByUuid = new Map(
      actor.items
         .filter(isRepairableAndDamaged)
         .map((item) => [item.uuid, item]),
   )

   if (candidates.length === 0) {
      return ui.notifications.info(`${actor.name} has no damaged tracked items.`)
   }

   const optionsHtml = candidates
      .map(
         (option) =>
            `<option value="${option.value.replace(/"/g, "&quot;")}">${option.label.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</option>`,
      )
      .join("")

   const chosenUuid = await DialogV2.wait({
      window: { title: `Damaged Items: ${actor.name}` },
      content: `
         <form>
            <div class="form-group">
               <label>Damaged item</label>
               <select name="broken-item">${optionsHtml}</select>
            </div>
         </form>
      `,
      buttons: [
         {
            action: "repair",
            label: "Open Repair",
            default: true,
            callback: (event, button, dialog) =>
               dialog.element.querySelector('select[name="broken-item"]')?.value ?? null,
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
      if (game.user.isGM) crafterActor = targetItem?.actor || actor
      else {
         return ui.notifications.warn(
            "Select a token to choose which character performs the repair.",
         )
      }
   }

   await moduleApi.launchRepairMacro(chosenUuid, crafterActor)
})()
