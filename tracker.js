var host = "http://ec2-54-254-105-248.ap-southeast-1.compute.amazonaws.com";
 
var currentSite = null;
var currentTabId = null;
var startTime = null;
var siteRegexp = /^(\w+:\/\/[^\/]+).*$/;

var updateCounterInterval = 1000 * 60;  // 1 minute.

var trackerServer = host + "/activities"

var lastActivitySeconds = 0;

/**
 * Returns just the site/domain from the url. Includes the protocol.
 * chrome://extensions/some/other?blah=ffdf -> chrome://extensions
 * @param {string} url The URL of the page, including the protocol.
 * @return {string} The site, including protocol, but not paths.
 */
function getSiteFromUrl(url) {
  var match = url.match(siteRegexp);
  if (match) {
    /* Check the ignored list. */
    var ignoredSites = localStorage["ignoredSites"];
    if (!ignoredSites) {
      ignoredSites = [];
    } else {
      ignoredSites = JSON.parse(ignoredSites);
    }
    for (i in ignoredSites) {
      if (ignoredSites[i] == match[1]) {
        console.log("Site is on ignore list: " + match[1]);
        return null;
      }
    }
    return match[1];
  }
  return null;
}

function checkIdleTime() {
  console.log("Checking idle time.");
  lastActivitySeconds += 10;
  console.log("Last activity was " + lastActivitySeconds + " seconds ago.");
  console.log("Paused = " + localStorage["paused"]);
  if (localStorage["paused"] == "false" && lastActivitySeconds > 60) {
    console.log("Idle for " + lastActivitySeconds + " seconds.");
    if (localStorage["idleDetection"] == "false") {
      console.log("Idle detection disabled, not pausing timer.");
    } else {
      pause();
    }
  }
}

function pause() {
  localStorage["paused"] = "true";
  chrome.browserAction.setIcon({path: 'images/icon_paused.png'});
}

function resume() {
  localStorage["paused"] = "false";
  chrome.browserAction.setIcon({path: 'images/icon.png'});
}

/**
 * This should be called whenever activity by the user is detected.
 */
function resetActivity() {
  lastActivitySeconds = 0;
  if (localStorage["paused"] == "true") {
    resume();
  }
}

function periodicClearStats() {
  console.log("Checking to see if we should clear stats.");
  var clearStatsInterval = localStorage["clearStatsInterval"];
  if (!clearStatsInterval) {
    clearStatsInterval = "0";
    localStorage["clearStatsInterval"] = "0";
  }
  clearStatsInterval = parseInt(clearStatsInterval, 10);
  console.log("Clear interval of " + clearStatsInterval);
  if (clearStatsInterval < 3600) {
    console.log("Invalid interval period, minimum is 3600.");
    delete localStorage["nextTimeToClear"]; 
    return;
  }
  
  var nextTimeToClear = localStorage["nextTimeToClear"];
  if (!nextTimeToClear) {
    var d = new Date();
    d.setTime(d.getTime() + clearStatsInterval * 1000);
    d.setMinutes(0);
    d.setSeconds(0);
    if (clearStatsInterval == 86400) {
      d.setHours(0);
    }
    console.log("Next time to clear is " + d.toString());
    nextTimeToClear = d.getTime();
    localStorage["nextTimeToClear"] = "" + nextTimeToClear;
  }
  nextTimeToClear = parseInt(nextTimeToClear, 10);
  var now = new Date();
  if (now.getTime() > nextTimeToClear) {
    console.log("Yes, time to clear stats.");
    clearStatistics();
    nextTimeToClear = new Date(nextTimeToClear + clearStatsInterval * 1000);
    console.log("Next time to clear is " + nextTimeToClear.toString());
    localStorage["nextTimeToClear"] = "" + nextTimeToClear.getTime();
    return;
  }
}

/**
 * Updates the counter for the current tab.
 */
function updateCounter() {
  /* Don't run if we are paused. */
  if (localStorage["paused"] == "true") {
    currentSite = null;
    return;
  }

  if (currentTabId == null) {
    return;
  }

  chrome.tabs.get(currentTabId, function(tab) {
    /* Make sure we're on the focused window, otherwise we're recording bogus stats. */
    console.log("i am here")
    chrome.windows.get(tab.windowId, function(window) {
      if (!window.focused) {
        return;
      }
      var site = getSiteFromUrl(tab.url);
      if (site == null) {
        console.log("Unable to update counter. Malformed url.");
        return;
      }

      /* We can't update any counters if this is the first time visiting any
       * site. This happens on browser startup. Initialize some variables so
       * we can perform an update next time. */
      if (currentSite == null) {
        currentSite = site;
        startTime = new Date();
        return;
      }

      /* Update the time spent for this site by comparing the current time to
       * the last time we were ran. */
      var now = new Date();
      var delta = now.getTime() - startTime.getTime();
      updateTime(currentSite, delta/1000);

      /* This function could have been called as the result of a tab change,
       * which means the site may have changed. */
      currentSite = site;
      startTime = now;
    });
  });
}

/**
 * Clears all statistics stored on server.
 */
 function clearStatistics() {
  /*
   if (localStorage["storageType"] == "appengine") {
     var xhr = new XMLHttpRequest();
     xhr.open(
       "GET", trackerServer + "/stats/clear", false);
     xhr.send(null);
   }
   */
   localStorage.sites = JSON.stringify({});
 }

 /**
  * Adds a site to the ignored list.
  */
  function addIgnoredSite(site) {
    console.log("Removing " + site);
    site = getSiteFromUrl(site);
    if (!site) {
      return;
    }
    var ignoredSites = localStorage.ignoredSites;
    if (!ignoredSites) {
      ignoredSites = [];
    } else {
      ignoredSites = JSON.parse(ignoredSites);
    }
    ignoredSites.push(site);
    localStorage.ignoredSites = JSON.stringify(ignoredSites);

    var sites = JSON.parse(localStorage.sites);
    delete sites[site];
    localStorage.sites = JSON.stringify(sites);
  }

/**
 * Sends statistics to the server. If there are no problems in sending the
 * data, we clear local storage. */
 function sendStatistics() {
  /*
   if (localStorage["paused"] == "true") {
     console.log("Paused, not sending statistics.");
     return;
   }
  */
   console.log("Sending statistics.");
   sendStatisticsToServer();
  
 }

 function sendStatisticsToServer() {
  var user = JSON.parse(localStorage.whoami);
  var sites = JSON.parse(localStorage.sites);

  if(sites.data){
    $.each(sites.data,function(site,data){
        $.ajax({
          url:host+"/activities",
          dataType:"JSON",
          type:"POST",
          data:{
            token:user.token,
            device:navigator.userAgent,
            start_time:Math.floor(data.startTime/1000),
            end_time:Math.floor(data.endTime/1000),
            activity:data.activity 
            
          },
          success:function(response){
            console.log(response);
             clearStatistics();
          },
          error:function(response){
            console.log(response)
          }
      })
    })
    
   
  }
 
}

/**
 * Updates the amount of time we have spent on a given site.
 * @param {string} site The site to update.
 * @param {float} seconds The number of seconds to add to the counter.
 */
function updateTime(site, seconds) {

  var sites = JSON.parse(localStorage.sites);

  if (!sites.data) {
    sites.data = {};
  }

  if (!sites[site]) {
    sites[site] = 0;
  }

  sites[site] = sites[site] + seconds;
  var now = new Date().getTime();  

  if (!sites.data[site]) {
    

    sites.data[site] = {
      "startTime":now,
      "endTime":now,
      "activity":site
      
    };
  }
  else{
    sites.data[site].endTime = sites.data[site].endTime+seconds*1000;

  }

  localStorage.sites = JSON.stringify(sites);

}

/**
 * Initailized our storage and sets up tab listeners.
 */
function initialize() {
  if (!localStorage.sites) {
    localStorage.sites = JSON.stringify({});
  }

  if (!localStorage.paused) {
    localStorage.paused = "false";
  }

  if (localStorage["paused"] == "true") {
    pause();
  }

  // Default is to do idle detection.
  if (!localStorage.idleDetection) {
    localStorage.idleDetection = "true";
  }

  /* Add some listeners for tab changing events. We want to update our
  *  counters when this sort of stuff happens. */
  chrome.tabs.onSelectionChanged.addListener(
  function(tabId, selectionInfo) {
    console.log("Tab changed");
    resetActivity();
    currentTabId = tabId;
    updateCounter();
  });

  chrome.tabs.onUpdated.addListener(
  function(tabId, changeInfo, tab) {
    if (tabId == currentTabId) {
      console.log("Tab updated");
      updateCounter();
    }
  });

  chrome.windows.onFocusChanged.addListener(
  function(windowId) {
    console.log("Detected window focus changed.");
    resetActivity();
    chrome.tabs.getCurrent(
      function(tab) {
        console.log("Window/Tab changed");
        if(tab && tab.id){
          currentTabId = tab.id;
          updateCounter();
        }
        console.log(localStorage.sites)
      });
  });

  chrome.browserAction.onClicked.addListener(function(tab) {
    sendStatistics();
  });

  /* Listen for update requests. These come from the popup. */
  chrome.extension.onRequest.addListener(
    function(request, sender, sendResponse) {
      if (request.action == "sendStats") {
        console.log("Sending statistics by request.");
        sendStatistics();
        sendResponse({});
      } else if (request.action == "clearStats") {
        console.log("Clearing statistics by request.");
        clearStatistics();
        sendResponse({});
      } else if (request.action == "addIgnoredSite") {
        addIgnoredSite(request.site);
        sendResponse({});
      } else if (request.action == "pause") {
        pause();
      } else if (request.action == "resume") {
        resume();
      } else {
        console.log("Invalid action given.");
      }
    });

    chrome.extension.onConnect.addListener(function(port) {
      console.assert(port.name == "idle");
      port.onMessage.addListener(function(msg) {
        resetActivity();
      });
    });

  /* Force an update of the counter every minute. Otherwise, the counter
     only updates for selection or URL changes. */
  window.setInterval(updateCounter, updateCounterInterval);

  /* Periodically check to see if we should be clearing stats. */
  window.setInterval(periodicClearStats, 60 * 1000);

  if (!localStorage["sendStatsInterval"]) {
    localStorage["sendStatsInterval"] = 1000;
  }

  /* Default is to use local only storage. */
  // if (!localStorage["storageType"]) {
  //  localStorage["storageType"] = "local";
  // }
  localStorage["storageType"] = "local";

  // Send statistics periodically.
  console.log("Sending stats interval " + localStorage["sendStatsInterval"]);
  window.setInterval(sendStatistics, 60 * 1000);

  // Keep track of idle time.
  window.setInterval(checkIdleTime, 10 * 1000);
}
window.addEventListener("load", initialize);