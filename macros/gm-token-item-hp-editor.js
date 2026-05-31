;(async () => {
   if (!game.user.isGM) {
      return ui.notifications.warn("Only a GM can use this macro.")
   }

   const { DialogV2 } = foundry.applications.api
   const token = canvas.tokens.controlled[0] || [...game.user.targets][0] || null
   const actor = token?.actor || null
   if (!actor) {
      return ui.notifications.warn(
         "Select or target one token to edit tracked item durability.",
      )
   }

   const getState = (item) => {
      if (item.type === "shield") {
         return {
            currentHp: Number(item.system?.hp?.value ?? 0),
            maxHp: Number(item.system?.hp?.max ?? 0),
            hardness: Number(item.system?.hardness ?? 0),
            isShield: true,
         }
      }

      const hasFlags =
         item.getFlag("world", "maxHp") !== undefined ||
         item.getFlag("world", "currentHp") !== undefined
      const isDefaultTracked = item.type === "armor" || item.type === "weapon"
      if (!hasFlags && !isDefaultTracked) return null

      return {
         currentHp: Number(item.getFlag("world", "currentHp") ?? 10),
         maxHp: Number(item.getFlag("world", "maxHp") ?? 10),
         hardness: Number(item.getFlag("world", "hardness") ?? 5),
         isShield: false,
      }
   }

   const candidates = actor.items
      .map((item) => ({ item, state: getState(item) }))
      .filter((entry) => entry.state && Number.isFinite(entry.state.maxHp))

   if (candidates.length === 0) {
      return ui.notifications.info(`${actor.name} has no tracked durability items.`)
   }

   candidates.sort((a, b) => a.item.name.localeCompare(b.item.name))

   const optionsHtml = candidates
      .map(
         ({ item, state }) =>
            `<option value="${item.id}">${item.name} (${state.currentHp}/${state.maxHp} HP, HD ${state.hardness})</option>`,
      )
      .join("")

   const selectedItemId = await DialogV2.wait({
      window: { title: `Durability Editor: ${actor.name}` },
      content: `
         <form>
            <div class="form-group">
               <label>Tracked item</label>
               <select name="item-id">${optionsHtml}</select>
            </div>
         </form>
      `,
      buttons: [
         {
            action: "next",
            label: "Edit Item",
            default: true,
            callback: (event, button, dialog) =>
               dialog.element.querySelector('select[name="item-id"]')?.value ?? null,
         },
         {
            action: "cancel",
            label: game.i18n.localize("Cancel"),
         },
      ],
      rejectClose: false,
   })

   if (!selectedItemId) return
   const selected = candidates.find((entry) => entry.item.id === selectedItemId)
   if (!selected) return

   const { item, state } = selected
   const edited = await DialogV2.wait({
      window: { title: `Edit HP: ${item.name}` },
      content: `
         <form>
            <div class="form-group">
               <label>Current HP</label>
               <input type="number" name="current-hp" value="${state.currentHp}" min="0" step="1" />
            </div>
            <div class="form-group">
               <label>Max HP</label>
               <input type="number" name="max-hp" value="${state.maxHp}" min="1" step="1" />
            </div>
            <div class="form-group">
               <label>Hardness</label>
               <input type="number" name="hardness" value="${state.hardness}" min="0" step="1" />
            </div>
         </form>
      `,
      buttons: [
         {
            action: "save",
            label: "Save",
            default: true,
            callback: (event, button, dialog) => {
               const currentHp = Number(
                  dialog.element.querySelector('input[name="current-hp"]')?.value ?? 0,
               )
               const maxHp = Number(
                  dialog.element.querySelector('input[name="max-hp"]')?.value ?? 1,
               )
               const hardness = Number(
                  dialog.element.querySelector('input[name="hardness"]')?.value ?? 0,
               )
               return { currentHp, maxHp, hardness }
            },
         },
         {
            action: "cancel",
            label: game.i18n.localize("Cancel"),
         },
      ],
      rejectClose: false,
   })

   if (!edited) return

   const maxHp = Math.max(1, Math.floor(Number(edited.maxHp) || 1))
   const currentHp = Math.max(0, Math.min(maxHp, Math.floor(Number(edited.currentHp) || 0)))
   const hardness = Math.max(0, Math.floor(Number(edited.hardness) || 0))

   if (state.isShield) {
      await item.update({
         "system.hp.value": currentHp,
         "system.hp.max": maxHp,
         "system.hardness": hardness,
      })
   } else {
      await item.update({
         "flags.world.currentHp": currentHp,
         "flags.world.maxHp": maxHp,
         "flags.world.hardness": hardness,
      })
   }

   ui.notifications.info(
      `${item.name} updated to ${currentHp}/${maxHp} HP (Hardness ${hardness}).`,
   )
})()
