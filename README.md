# stateful-process-command-proxy
Node.js module for executing os commands against a pool of stateful, long-lived child processes such as bash or powershell

It is important to note, that despite the use-case described below for this project's origination, this node module can be used for proxying long-lived bash process (or any shell really) in addition to powershell etc. It works and has been tested on both *nix, osx and windows hosts running the latest version of node.

### Origin

This project originated out of the need to execute various Powershell commands (at fairly high volume and frequency) against services within Office365/Azure bridged via a custom node.js implemented REST API; this was due to the lack of certain features in the REST GraphAPI for Azure/o365, that are available only in Powershell. 

If you have done any work with Powershell and o365, then you know that there is considerable overhead in both establishing a remote session and importing and downloading various needed cmdlets. This is an expensive operation and there is a lot of value in being able to keep this remote session open for longer periods of time rather than repeating this entire process for every single command that needs to be executed and then tearing everything down.

Simply doing an **exec** per command to launch an external process, run the command, and then killing the process is not really an option under such scenarios, as it is expensive and very singular in nature; no state can be maintained if need be. We also tried using [edge.js with powershell](https://github.com/tjanczuk/edge#how-to-script-powershell-in-a-nodejs-application) and this simply would not work with o365 exchange commands and session imports as the entire node.js process would crash.

The diagram below should conceptually give you an idea of what this module does. 

![Alt text](/diagram.png "Diagram1")
