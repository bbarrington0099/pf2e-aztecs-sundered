import { registerSettings } from "./settings.mjs"
import { registerItemHooks } from "./hooks/item-hooks.mjs"
import { registerSheetHooks } from "./hooks/sheet-hooks.mjs"
import { registerChatHooks } from "./hooks/chat-hooks.mjs"
import { registerCombatHooks } from "./hooks/combat-hooks.mjs"
import {
   registerAutomationHooks,
   runShieldBlockAutomation,
   promptAndRunShieldBlockAutomation,
} from "./hooks/automation-hooks.mjs"
import { SunderApp } from "./apps/sunder-app.mjs"
import { RepairApp } from "./apps/repair-app.mjs"

const MODULE_ID = "pf2e-aztecs-sundered"
const MACRO_PACK_ID = `${MODULE_ID}.pf2e-sundered-macros`
const BUNDLED_MACROS = [
   {
      name: "Manual Shield Block Fallback",
      file: "manual-shield-block-fallback.js",
      img: "icons/equipment/shield/buckler-wooden-boss-brown.webp",
   },
   {
      name: "Party Repair Picker",
      file: "party-repair-picker.js",
      img: "icons/tools/smithing/anvil.webp",
   },
   {
      name: "Target Broken Items Picker",
      file: "target-broken-items-picker.js",
      img: "icons/tools/smithing/hammer-sledge-steel-grey.webp",
   },
   {
      name: "GM Token Item HP Editor",
      file: "gm-token-item-hp-editor.js",
      img: "icons/tools/smithing/crucible-round.webp",
   },
]

const resolveItemReference = async (itemOrUuid) => {
   if (!itemOrUuid) return null
   if (typeof itemOrUuid === "string") {
      if (typeof fromUuidSync === "function") {
         const syncItem = fromUuidSync(itemOrUuid)
         if (syncItem) return syncItem
      }
      if (typeof fromUuid === "function") {
         const asyncItem = await fromUuid(itemOrUuid)
         if (asyncItem) return asyncItem
      }
      return null
   }
   return itemOrUuid
}

const resolveActorReference = async (actorOrUuid) => {
   if (!actorOrUuid) return null
   if (typeof actorOrUuid === "string") {
      if (typeof fromUuidSync === "function") {
         const syncActor = fromUuidSync(actorOrUuid)
         if (syncActor) return syncActor
      }
      if (typeof fromUuid === "function") {
         const asyncActor = await fromUuid(actorOrUuid)
         if (asyncActor) return asyncActor
      }
      return game.actors.get(actorOrUuid) || null
   }
   return actorOrUuid
}

const loadBundledMacroCommand = async (macroFileName) => {
   const macroUrl = `modules/${MODULE_ID}/macros/${macroFileName}`
   const response = await fetch(macroUrl)
   if (!response.ok) {
      throw new Error(`Failed to fetch bundled macro: ${macroFileName}`)
   }
   return response.text()
}

const buildBundledMacroData = async (bundleConfig) => {
   const command = await loadBundledMacroCommand(bundleConfig.file)
   return {
      name: bundleConfig.name,
      type: "script",
      img: bundleConfig.img,
      command,
      flags: {
         [MODULE_ID]: {
            bundledMacroFile: bundleConfig.file,
         },
      },
   }
}

const upsertMacroDocuments = async (collection, macroDataList, createFn, updateFn) => {
   const byFile = new Map()
   for (const macroDoc of collection) {
      const file = macroDoc.flags?.[MODULE_ID]?.bundledMacroFile
      if (file) byFile.set(file, macroDoc)
   }

   const docsToCreate = []
   const docsToUpdate = []

   for (const macroData of macroDataList) {
      const existing = byFile.get(macroData.flags[MODULE_ID].bundledMacroFile)
      if (!existing) {
         docsToCreate.push(macroData)
         continue
      }
      if (
         existing.name !== macroData.name ||
         existing.img !== macroData.img ||
         existing.command !== macroData.command
      ) {
         docsToUpdate.push({
            _id: existing.id,
            name: macroData.name,
            img: macroData.img,
            command: macroData.command,
         })
      }
   }

   if (docsToCreate.length > 0) await createFn(docsToCreate)
   if (docsToUpdate.length > 0) await updateFn(docsToUpdate)
   return { created: docsToCreate.length, updated: docsToUpdate.length }
}

const ensureBundledMacrosAvailable = async () => {
   if (!game.user.isGM) return

   const macroDataList = await Promise.all(BUNDLED_MACROS.map(buildBundledMacroData))
   const pack = game.packs.get(MACRO_PACK_ID)

   if (pack && pack.documentName === "Macro") {
      if (pack.locked) {
         try {
            await pack.configure({ locked: false })
         } catch (error) {
            console.warn(`${MODULE_ID} | Could not unlock macro pack`, error)
         }
      }
   }

   if (pack && pack.documentName === "Macro" && !pack.locked) {
      const packDocuments = await pack.getDocuments()
      await upsertMacroDocuments(
         packDocuments,
         macroDataList,
         (docs) => Macro.createDocuments(docs, { pack: pack.collection }),
         (docs) => Macro.updateDocuments(docs, { pack: pack.collection }),
      )
      return
   }

   await upsertMacroDocuments(
      game.macros.contents,
      macroDataList,
      (docs) => Macro.createDocuments(docs),
      (docs) => Macro.updateDocuments(docs),
   )
}

Hooks.once("init", () => {
   registerSettings()
   game.modules.get(MODULE_ID).api = {
      launchSunderMacro: (actor, data, preselectedId) =>
         new SunderApp({
            actor,
            attackerData: data,
            preselectedItemId: preselectedId,
         }).render(true),
      runShieldBlockAutomation: (actorOrId, incomingDamage) =>
         runShieldBlockAutomation(actorOrId, incomingDamage),
      promptShieldBlockAutomation: (actorOrId) =>
         promptAndRunShieldBlockAutomation(actorOrId),
      launchRepairMacro: async (itemOrUuid, crafterActorOrUuid = null) => {
         const item = await resolveItemReference(itemOrUuid)
         if (!item) {
            ui.notifications.warn("Repair target item not found.")
            return false
         }
         const crafterActor =
            (await resolveActorReference(crafterActorOrUuid)) || item.actor
         new RepairApp({ item, actor: crafterActor }).render(true)
         return true
      },
   }
})

Hooks.once("ready", () => {
   ensureBundledMacrosAvailable().catch((error) => {
      console.error(`${MODULE_ID} | Failed to ensure bundled macros`, error)
   })
})

registerItemHooks()
registerSheetHooks()
registerChatHooks()
registerCombatHooks()
registerAutomationHooks()
