PF2e Aztec's Sundered allows for tracking items durability and apply respective buffs on broken or destroyed items.

Demonstration of the main PC interface and basic functionality: dealing damage to the item, dealing damage ignoring its Hardness, and how does the Broken condition afflict a weapon:
![bandicam 2026-04-01 06-52-04-180 (1)](https://github.com/user-attachments/assets/2b25accc-459b-451a-81d9-dcfa3e5fae1c)

---

Demonstration of how does the Broken condition afflict an armour: 
![bandicam 2026-04-01 06-53-09-337](https://github.com/user-attachments/assets/e1390093-f41b-42e1-a711-59b4a88c59e9)

---

Demonstration of quick Material assignment:
![bandicam 2026-04-01 06-53-33-446](https://github.com/user-attachments/assets/65648b71-5f9a-4058-8575-003b15583aa2)

---

You can track different items, not necessarily only weapons and armours:
![bandicam 2026-04-01 06-54-00-539](https://github.com/user-attachments/assets/72836d10-9554-4468-9c37-a4f2537a2f9e)

---

NPCs are treated a bit differently, giving much more flexibility to the GM:
![bandicam 2026-04-01 06-55-43-124](https://github.com/user-attachments/assets/d2210bab-3557-4d9e-bae6-6f59dd7368ea)

---

Demo of Settings:
![bandicam 2026-04-01 06-56-29-452](https://github.com/user-attachments/assets/462b1ac2-b2c6-436c-8a1f-0ae5a3acac5c)

---

Demo of Inventory UI:
![bandicam 2026-04-01 06-56-55-534](https://github.com/user-attachments/assets/bbd073b0-4db7-453a-9048-cd043ac0743f)

---

### Shield Block Automation

When enabled, Shield Block usage from core PF2e chat flow receives a chat action button that opens a modal:

- Prompt for incoming damage before hardness
- Requires a raised/effective shield
- Applies RAW-style blocked damage to both shield and actor:
  - `blockedDamage = max(0, incomingDamage - shieldHardness)`
  - Shield HP decreases by `blockedDamage`
  - Actor HP decreases by `blockedDamage`
- Actor HP reduction from Shield Block can then trigger armor durability automation (if enabled and confirmed/qualified)

### Recommended penalty balance (if using these homebrew options)

- Broken weapon penalty: `-1`
- Broken armor penalties: `-1` for light, medium, and heavy

### Manual fallback macro (Shield Block)

A manual fallback macro is included for tables that want a direct trigger:

- File: `macros/manual-shield-block-fallback.js`
- Behavior:
  - Uses selected token actor (or user character)
  - Prompts for incoming damage
  - Applies Shield Block Automation through module API

### Party Repair Picker macro

An additional macro is included to speed up Repair workflow across party members:

- File: `macros/party-repair-picker.js`
- Behavior:
  - Scans Party actors and their members
  - Lists tracked items that are below max HP (including even 1 HP of damage)
  - Sorts entries by highest damage percentage first
  - Lets you choose one item from a macro dialog
  - Opens the normal Repair app for the selected item
  - Uses the selected token's Crafting for the repair check; if no token is selected, GMs fall back to the gear owner and non-GMs receive an error

### Target Broken Items macro

A second macro is included for fast per-target triage:

- File: `macros/target-broken-items-picker.js`
- Behavior:
  - Uses first targeted token (or first controlled token as fallback)
  - Lists damaged tracked items for that actor (not only broken/destroyed)
  - Sorts entries by highest damage percentage first
  - Lets you choose one item from a macro dialog
  - Opens the normal Repair app for the selected item
  - Uses the selected token's Crafting for the repair check; if no token is selected, GMs fall back to the gear owner and non-GMs receive an error

### GM Token Item HP Editor macro

A GM utility macro is included for fast durability edits without opening sheets:

- File: `macros/gm-token-item-hp-editor.js`
- Behavior:
  - GM-only
  - Uses the selected token (or first targeted token)
  - Lists tracked durability items
  - Lets you quickly edit current HP, max HP, and hardness

### API helpers

The module API now exposes:

- `game.modules.get("pf2e-aztecs-sundered").api.runShieldBlockAutomation(actorOrId, incomingDamage)`
- `game.modules.get("pf2e-aztecs-sundered").api.promptShieldBlockAutomation(actorOrId)`
- `game.modules.get("pf2e-aztecs-sundered").api.launchRepairMacro(itemOrUuid, crafterActorOrUuid?)`

### Bundled macro availability

On world load, the module now auto-seeds bundled macros (including newly added custom macros):

- Preferred destination: `PF2e Sundered Macros` compendium pack
- Fallback destination: world macro directory (if compendium cannot be unlocked/written)

This keeps new bundled macros available automatically, similar to the existing Sunder macro workflow.

---

## Homebrew Gear Degradation Automation

This module now includes fully optional automation features for homebrew durability rules.  
All of these are disabled by default unless noted otherwise.

### New settings

- `Homebrew: Crit-fail weapon damage (PCs)`
- `Homebrew: Crit-fail weapon damage (NPCs)`
- `Homebrew: Armor damage from HP hits (PCs)`
- `Homebrew: Armor damage from HP hits (NPCs)`
- `Homebrew: PC armor damage assumes Stamina variant` (default: enabled)
- `Homebrew: PC armor damage threshold (%)` (default: 75)
- `Homebrew: NPC armor damage threshold (%)` (default: 75)
- `Homebrew: Shield Block Automation (PCs)`
- `Homebrew: Shield Block Automation (NPCs)`
- `Homebrew: Show automation chat messages` (default: enabled)

### Crit-fail weapon durability

When enabled, critical-failure attack rolls with a weapon get a chat action button:

- Click `Weapon Breakage` to roll self-damage automatically from the weapon's normal damage formula
- Apply durability damage to the same weapon as:
  - `max(0, rolledDamage - weaponHardness)`
- If there is no weapon item associated with the attack, this automation is skipped

### Armor durability from HP damage

When enabled, armor-slot armor (not shields) can take durability damage when actor HP drops:

- Trigger condition:
  - Actor HP decreases
  - Armor automation is enabled for that actor type (PC/NPC)
  - Actor has armor equipped in the armor slot
- Physical-damage gate:
  - Each HP drop asks for Yes/No confirmation whether that damage should apply to armor durability
  - Prompt uses Foundry modal dialogs
- Damage calculation:
  - Stamina mode (PC only, when enabled): all HP damage can spill to armor
  - Threshold mode: only the HP-damage portion below the configured threshold% can spill to armor
  - Durability loss is `max(0, spilloverDamage - armorHardness)`

---

To install the package, copy the raw manifest link from this repository and paste it into your main Foundry setup screen.
