# OS and Setup

- **Source:** https://cmdrcyrious.com/planetside2/performance-guide/os-and-setup/
- **Saved:** 2026-11-09
- **Status:** live, HTTP 200
- **Raw HTML:** `raw/planetside2__performance-guide__os-and-setup.html`
- **Extraction:** trafilatura

---

---
title: OS and Setup | CMDRCyrious.com
url: https://cmdrcyrious.com/planetside2/performance-guide/os-and-setup/
hostname: cmdrcyrious.com
description: Performance guide covering operating system and general settings outside of the game
sitename: CMDRCyrious.com | Take your gaming Cyriously!
date: "2020-03-20"
fingerprint: f7be99560b258ebc
---
This page will highlight some of the possible settings and optimization within the operating system.

# Operating System

- If your system has been running for several years, it may be [**a good idea to reinstall**](http://www.tomshardware.com/news/how-to-do-clean-installation-windows-10,36160.html), or at least do some cleanup:
  - **[Kerish Doctor](http://www.kerish.org/en/)** is a comprehensive solution for cleaning up Windows, and has useful functions like fixing registry errors. It has a 15 day free trial period, which should be enough to get your OS in order.
- Make sure that your Operating System is clean and has no viruses or malware:
  - **[DrWeb CureIt!](https://free.drweb.com/download+cureit+free/?lng=en)** is a free tool that scans for viruses. Unlike most antiviruses, you don’t have to keep it running all the time, you just download the latest version of the CureIt! and perform a scan once.
  - **[MalwareBytes Anti-Malware](https://www.malwarebytes.org/)** is a free tool that scans for malware – the type of harmful trash programs that don’t quite qualify to be viruses, but still can cause issues. MalwareBytes has a free version that can be used the same way as CureIt!.
- Install all relevant Windows updates by enabling Windows Update in Control Panel.
- Install fresh drivers for your hardware.
- Make sure your system is not suffering from the **[HPET Bug](http://cmdrcyrious.com/planetside2/performance-guide/hardware)**.
- Disable all unnecessary background programs while playing PS2. You can do it manually, or use **[Razer Gamebooster](https://www2.razerzone.com/cortex/boost)** freeware or **Windows 10 Game Mode** to do it for you.

## Choosing Operating System

- PlanetSide 2 will ***not*** run on any version of Windows XP.
- PlanetSide 2 ***requires*** a 64 bit OS.

There are no other hard requirements, and if you’re satisfied with your current version of Windows, there is no need to change it.

## **PlanetSide 2 and Windows 10**

![](http://cmdrcyrious.com/wp-content/uploads/2016/04/Windows-10-logo-150x150.jpg)


The majority of people will have upgraded to Windows 10 at this point. Make sure that you install your updates and that windows isn’t downloading updates while you are playing.

There are a lot of things that gamers can do to optimize windows. A general recommendation is to uninstall unnecessary apps that are pre-installed with windows. Also disabling startup on boot for programs that are irrelevant to gamin should be done, and generally only ever opening software when actually needed is a good practice.

[Example of a fresh startup with windows](https://www.youtube.com/watch?v=WXwMbmhCQuY)


## Other ways to increase performance

### Spectre and Meltdown Protection

Spectre and Meltdown are exploits that can be used by bad people to do bad things to your PC. If you update your OS and BIOS, you must likely already have protection against these exploits, but the problem is that those additional security measures eat a lot of CPU performance.

If you’re desperate to boost your performance, you can **[use this tool to temporarily disable Spectre and Meltdown Protection](https://www.grc.com/inspectre.htm)**.


### Disabling Core 0

Note: adjusting **Windows Power Settings** is a better solution to [this problem](https://www.reddit.com/r/Planetside/comments/4lza28/why_disabling_core_0_can_improve_performance_and/), this is only listed here for general educating purposes. Also, this has no positive effect on Windows 10-based systems


\[spoiler title=”Disabling Core 0″\]

If your CPU has 4 cores or more, you can disable the Core number 0 for PlanetSide 2.

This can potentially increase performance, because Windows primarily runs on Core 0, and thus when PlanetSide needs to do something it can be stuck in line behind those Windows processes.

By telling planetside to avoid Core 0 you avoid the problem altogether. The less planetside has to wait, the better your FPS.

**How to:**

- Open your task manager by pressing Ctrl + Alt + Delete. Start up PlanetSide up to character select screen.
- Press Alt + TAB to switch to task manager. Locate and right click the PlanetSide2\_x64.exe process. Choose “Set Affinity”. Uncheck Core 0. Click OK. Done.
  - This can potentially give you a 10-30(!) FPS Boost, your mileage may vary.
- Currently unknown if it will have any effect on Win 10.

This setting does not persist between PlanetSide sessions and restarts, you have to set it manually each time you launch PS2.


Try out this method and see if you get a performance boost. If it does help, you can use the mini-guide by Ahorns below to create a shortcut that will automatically launch PS2 with Core 0 disabled.

#### **Starting PlanetSide 2 without Core 0**

First, how many Cores do you have and are you using Hyperthreading? Remember this Hex number:

4 Cores = E
4 Cores with HT (8 Threads) = FC
6 Cores = 3E
6 Cores with HT (12 Threads) = FFC
8 Cores = FE
8 Cores with HT (16 Threads) = FFFC

- Right click or press and hold on an empty area of your desktop, and click/tap on New and Shortcut. Type the command below into the location area, and click/tap on the Next button.

replace the # with your Hex Code and the destination with your launchpad destination, for me, that would be c:\ps2\launchpad.exe

cmd.exe /c start "Planetside 2" /affinity # "Full path of application file"

- for example:

cmd.exe /c start "Planetside 2" /affinity 3E "c:\ps2\launchpad.exe"

- click next and type in any name you want
- you can change the picture of that shortcut, too, if you like
- When you start this shortcut now, it starts the launchpad without core 0, which starts the game without core 0, and that’s what we want 😀

**This can not damage your CPU, it will only take load off it. Your mileage may vary.**

## CPU Power Settings

To save power, most modern CPUs adjust their clock frequency depending on load. Basically, when there’s nothing to do frequency decreases to save power, and when there’s a lot of stuff to calculate, frequency increases.

Same principle for core parking – during low load, one or several cores may “park” – temporarily disable. They will “unpark” when necessary.

However, these changes to frequency are not instant; delays are enough to cause framerate drops.

The easiest way to solve this is to just force your CPU to always run at maximum frequency.

![Windows Power Options](http://cmdrcyrious.com/wp-content/uploads/2016/04/power_options-1024x490.jpg)


- Go to Windows Control Panel -> Power Options. There select “High Performance”.
- Then click “Change plan settings” to right of it.
- Click “Change advanced power settings”. A window will open.
- In the list, find “Processor power management”.
  - Set “Minimum processor state” as “100%”
  - Set “System cooling policy” as “Active”
  - Set “Maximum processor state” as “100%”
- Note that this may consume more power and place your system under more strain and heat over time; use this if you’re having inconsistent performance


## GPU Power Settings

I was monitoring my GPU while playing, and I noticed that with Power Management Mode at its default ‘Optimal’ setting, there would be about a 1 second pause when entering/exiting the map screen and terminals, during which GPU usage dropped to 0%, and clock speeds dropped from 3D to 2D clocks, before going back up.

With ‘Prefer Maximum Performance’, GPU usage and clocks no longer drop, and the pause is almost eliminated.


![](http://cmdrcyrious.com/wp-content/uploads/2017/11/nvidia-prefer-maximum-performance.png)


## GeForce Experience and nVidia Shadowplay

Shadowplay and GeForce Experience sometimes cause performance issues in PlanetSide 2 and games in general. **Consider disabling nVidia Share or uninstalling GeForce Experience altogether**, if you are having performance issues.

GeForce Experience 3.0 is specifically known for being worse than GeForce Experience 2.0 in every way imaginable. If you want, you can rollback to the previous version.

1. Go to Windows Control Panel and uninstall your current version of GeForce Experience.
2. Download and install **[GeForce Experience v2.11.4.0](http://www.filehorse.com/download-nvidia-geforce-experience/26526/download/).**
3. Launch System Configuration utility by pressing Windows + R and typing “msconfig”. Or simply search for System Configuration in start menu.
4. Go to “Services” and uncheck nVidia Network Service.

![](http://cmdrcyrious.com/wp-content/uploads/2017/11/nvidia-network-service.png)


This will prevent the GeForce Experience from automatically updating to a newer version. You will have to download driver updates manually from the nVidia site. When installing new drivers, make sure to uncheck GeForce Experience. As long as you don’t check “clean install”, this should not uninstall your older version of GeForce Experience.

## Network Calibration

### Disabling Nagle’s Algorithm

This is often recommend to improve network performance in online games, but it will not work in PlanetSide 2, since Nagle’s Algorithm applies only to TCP protocol, while **[PlanetSide 2 uses UDP](https://www.reddit.com/r/Planetside/comments/7wsrxv/general_tips_on_how_to_get_extra_fps/du2zyym/)**.

### Using a VPN

VPN stands for “Virtual Private Network”. It is usually used for the purposes of privacy or bypassing content restrictions, but it can also potentially **[improve your connection to PlanetSide 2 servers](https://www.reddit.com/r/Planetside/comments/8v58tm/anybody_using_a_vpn_to_play_ps2/)**, making it more stable and reducing latency.

Most decent VPN require regular payments, but usually offer free trials, so you don’t risk anything by trying one out.

Here’s the list of VPN that have been confirmed to improve connection to PS2:

- **[Avast SecureLine](https://www.avast.com/secureline-vpn#pc)**
- **Windscribe**

European servers for PlanetSide 2 are located in Amsterdam, Netherlands.

## Display Calibration

Everyone’s eyes are different, and monitors rarely have good factory calibration, so it’s always a good idea to calibrate your display.

- First, launch Windows’ **Display Color Calibration** tool. [**This guide**](https://www.laptopmag.com/articles/calibrate-monitor-windows-10) will show you how.
- Once the tool is launched, summon your monitor’s **On Screen Menu**. Usually, this is done by pressing control buttons on the monitor’s frame.

![](http://cmdrcyrious.com/wp-content/uploads/2017/12/gamma1-1024x768.jpg)


**Note:** On Screen Menu will look different depending on Monitor’s manufacturer and model. Refer to your monitor’s support page on manufacturer’s website if you have any issues.

- In the On Screen Menu, locate **Gamma** setting, and set it to **1.8**. This will increase visibility in PlanetSide 2 during night time, at the cost of reduced overall contrast.

![](http://cmdrcyrious.com/wp-content/uploads/2017/12/gamma2.png)


- Then, fine tune the Gamma setting in Display Color Calibration tool, and follow the next steps of the calibration wizard.
- You will have to calibrate Brightness, Contrast and Colors. Follow the wizard’s instructions at the bottom.

![](http://cmdrcyrious.com/wp-content/uploads/2017/12/osd-brightness-e1514433771204-1024x737.jpg) 

![](http://cmdrcyrious.com/wp-content/uploads/2017/12/OSD-contrast-e1514433758707-1024x727.jpg)

![](http://cmdrcyrious.com/wp-content/uploads/2017/12/OSD-colors-e1514433741181-1024x673.jpg)


- All calibrations should be done through monitor’s On Screen Menu. This will allow the calibrations to persist through multiple Windows installations, and will let the calibrations persist in all games and movies.

Your Monitor’s On Screen Menu may also give you access to additional settings, such as Shaprness, refresh rate overclocking, increased color transition, correction of light trails, etc. Refer to your monitor’s manual for the complete list and instructions. 

Don’t be afraid to experiment, you should always be able to reset the monitor to factory defaults in the On Screen Menu if you mess up the calibration beyond repair.

## Color Vibrance

Increasing color vibrance will make colors more pronounced, increasing in-game visibility.

Go for the highest value that looks acceptable to you. Note that this is a global setting and will affect colors in all applications.
