;(async () => {
   const moduleApi = game.modules.get("pf2e-aztecs-sundered")?.api
   if (!moduleApi?.promptShieldBlockAutomation) {
      return ui.notifications.error(
         "PF2e Aztec's Sundered API not found. Is the module active?",
      )
   }

   const actor = canvas.tokens.controlled[0]?.actor || game.user.character || null

   if (!actor) {
      return ui.notifications.warn(
         "Select a token (or assign a user character) before running this macro.",
      )
   }

   await moduleApi.promptShieldBlockAutomation(actor)
})()
