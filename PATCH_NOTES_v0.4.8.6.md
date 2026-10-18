# RIMRIFT — v0.4.8.6 Patch Notes

v0.4.8.6 is the identity patch: Afterhours 16 is now **RIMRIFT**. The game opens on a new title screen, the menus wear the new Ember, Bone and Carbon colors, and the name and logo change everywhere you see them. Nothing about how the game plays has changed. Your account, players, VC and items carry over untouched.

Everyone has to be on v0.4.8.6 to play online together. Pull the update before you connect.

---

## The title screen
- **Before the game loads,** RIMRIFT opens on its own title screen: the key art, the logo and MAKE YOUR OWN GRAVITY.
- **To enter,** use ENTER THE COURT, click, press Enter, Space or Esc, or press A or Start on a controller.
- **A button already held when the screen appears doesn't count.** Let go and press it again.
- **Launched from Afterhours16.exe,** the click or key that enters the game also locks the window in (fullscreen and keyboard), the way your first click used to. A controller press can't do that (a browser rule), so then your first click or key in the game still does it.
- **Settings → Title screen** brings it back any time.
- **No music** plays on the title screen.

## The new look
- **New colors:**
  - **Ember** (#FF4D24) for buttons, tabs, highlights, progress bars and "YOU" tags;
  - **Bone** (#F3EEE4) for headline text;
  - **Carbon** (#080A0D) for backgrounds.
- **Text on Ember buttons stays dark,** for contrast (about 6:1).
- **Still gold, on purpose:**
  - VC and prices, your OVR tile, Gold badges, Hall of Fame and ICON colors;
  - the C grade, the MVP tag, the Daily Spin jackpot, bounties;
  - event and team colors.
- **The ring under your own player stays yellow,** so it can't be mistaken for an opponent's red ring.
- **The shot clock is Bone,** so its low-clock red stands out.
- **The logo:**
  - the RIMRIFT wordmark in the top bar;
  - the full logo on the welcome card and the boot screen;
  - a new browser-tab and app icon.

  All of them are vector, so they stay sharp at any size.

## The name, everywhere
- **In the menus:** the window title, boot screen, menus, quit dialog and the phone's header now say RIMRIFT.
- **The arena:** RIMRIFT on the sidelines and the mark at center court, and RIMRIFT PRO-AM on the LED ribbon and the scorer's table. With a Pro-Am team, your team's own colors and logo still take over.
- **The Pro Run league** is now the **RIMRIFT Pro League** (RPL). Saved careers carry on.
- **The soundtrack** is now the RIMRIFT Soundtrack.
- **Branded gear in the store:**
  - The Afterhours jerseys, pullover and tees now carry the RIMRIFT name and lettering. A/H becomes R/R and AH16 becomes RR.
  - If you own one, you keep it; it just wears the new name.
  - The AH on every shoe heel is now RR.
- **Hosting online:** the router port mapping is labeled RIMRIFT.

## What stays the same for now
- **Folder, launcher and files:**
  - The game folder (C:\Afterhours16), Afterhours16.exe and its icon, and start/host/join.cmd keep their names. They change when RIMRIFT moves to its new engine (Stage 1 of the v0.5 roadmap).
  - The launcher's own setup messages still say Afterhours 16.
  - Your saves are untouched.
- **Bug reports** still go to Afterhours16_Bug_Reports.txt in the game folder.
- **Mode names** (Pro-Am, badges, the player builder) stay as they are. The proposed renames come with the menu rebuild.
- **The title screen's key art is labeled GENERATED CONCEPT ART.** It shows where the game is heading, not today's graphics.

---

*(Tests: 179 Python and 462 node tests. Browser checks covered the title screen (mouse, keyboard and controller, fresh presses only, the launcher heartbeat and lock-in), the welcome card, home, MyPlayer, the store, Settings, the Park screen, Pro-Am, a park and a game HUD, and the results screen. They also covered the arena from four cameras, a team arena (unchanged), the rebranded gear on a player, and the logo and icons at 16, 32 and 64 px. The traced logo matches the original artwork at an overlap of 0.99 for each color.)*
