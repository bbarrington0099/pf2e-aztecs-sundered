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

Hooks.once("init", () => {
   registerSettings()
   game.modules.get("pf2e-aztecs-sundered").api = {
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
   }
})

registerItemHooks()
registerSheetHooks()
registerChatHooks()
registerCombatHooks()
registerAutomationHooks()
