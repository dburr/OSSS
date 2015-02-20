// OSSS (Open Source Surveillance and Security)
// (Not-so-)Simple Web App
// 
// Donald Burr <dburr@vctlabs.com>, 12/12/2014

var async = require('async');
var http = require('http')
var url = require('url')
var fs = require('fs')
var path = require('path')
var os = require("os");
var ffmpeg = require('fluent-ffmpeg')
var metalib = ffmpeg.Metadata
var nStore = require('nstore').extend(require('nstore/query')());
var ps = require('ps-node');
var sys = require('sys')
var exec = require('child_process').exec;

var dbIsReady = false;

// workaround for some node.js api changes
fs.exists = fs.exists || require('path').exists;
fs.existsSync = fs.existsSync || require('path').existsSync;

// debug mode
var DEBUG = false;
var NOISY_DEBUG = false;

// width and height of the video window
// these MUST match "width" and "height" settings in motion.conf!
var WIDTH = 320;
var HEIGHT = 240;

// number of pixels of padding to add to IFRAME (required by some browsers,
// notably Firefox, to prevent scroll bars from appearing within the IFRAME)
var PADDING = 20;

// where video files are stored, must match "target_dir" setting in motion.conf!
var VIDEOS_DIR = "/var/spool/motion/";

// sort order defaults to forward
var reverse_sort_order = 0;

// get arguments
var args = process.argv.slice(2);
if (args.length > 0)  {
  if (args[0] === "-d")  {
    console.log("Debug mode enabled.");
    DEBUG = true;
  }
  if (args[0] === "-n")  {
    console.log("Noisy debug mode enabled.");
    DEBUG = true;
    NOISY_DEBUG = true;
  }
}

// port to use
var PORT = 80;
if (DEBUG)  {
  console.log("Using port 8000 since we are in DEBUG mode.");
  PORT = 8000;
}

// Check to see whether motion is running or not
function check_motion_state(state_callback)
{
  // A simple pid lookup
  ps.lookup({
    command: 'motion',
    psargs: 'auxw'
    }, function(err, resultList ) {
    if (err) {
        if (NOISY_DEBUG)  {
            console.log("ERROR getting process info: " + err);
            state_callback(false, -1);
        }
    }

    if (resultList.length < 1)  {
      state_callback(false, 0);
    } else {
      state_callback(true, resultList[0].pid);
    }
  });
}

// pretty-print # of seconds as hrs:mintes:seconds
function secondsToString(seconds, shortFormat)
{
  shortFormat = typeof shortFormat !== 'undefined' ? shortFormat : false;
  var str = "";
  //var numyears = Math.floor(seconds / 31536000);
  var numdays = Math.floor((seconds % 31536000) / 86400); 
  var numhours = Math.floor(((seconds % 31536000) % 86400) / 3600);
  var numminutes = Math.floor((((seconds % 31536000) % 86400) % 3600) / 60);
  var numseconds = (((seconds % 31536000) % 86400) % 3600) % 60;
  if (shortFormat)  {
    if (numdays > 0)  {
      str += numdays + "d";
    }
    if (numhours > 0)  {
      str += numhours + "h";
    }
    if (numminutes > 0)  {
      str += numminutes + "m";
    }
    if (numseconds > 0)  {
      str += numseconds + "s";
    }
  } else {
    if (numdays > 0)  {
      str += numdays + " days, ";
    }
    if (numhours > 0)  {
      str += numhours + " hours, ";
    }
    if (numminutes > 0)  {
      str += numminutes + " minutes, ";
    }
    if (numseconds > 0)  {
      str += numseconds + " seconds";
    } 
  }
  return str;
}

// fun with timezone offsets
function pad(value) {
  return value < 10 ? '0' + value : value;
}

function createOffset(offset_in) {
  var sign = (offset_in > 0) ? "-" : "+";
  var offset = Math.abs(offset_in);
  var hours = pad(Math.floor(offset / 60));
  var minutes = pad(offset % 60);
  return sign + hours + ":" + minutes;
}

function formatAMPM(date) {
  var hours = date.getHours();
  var minutes = date.getMinutes();
  var ampm = hours >= 12 ? 'pm' : 'am';
  hours = hours % 12;
  hours = hours ? hours : 12; // the hour '0' should be '12'
  minutes = minutes < 10 ? '0'+minutes : minutes;
  var strTime = hours + ':' + minutes + ' ' + ampm;
  return strTime;
}

function humanFileSize(bytes, si) {
  var thresh = si ? 1000 : 1024;
  if(bytes < thresh) return bytes + ' B';
    var units = si ? ['kB','MB','GB','TB','PB','EB','ZB','YB'] : ['KiB','MiB','GiB','TiB','PiB','EiB','ZiB','YiB'];
    var u = -1;
    do {
      bytes /= thresh;
      ++u;
   } while(bytes >= thresh);
   return bytes.toFixed(1)+' '+units[u];
};

function endsWith(str, suffix) {
  return str.indexOf(suffix, str.length - suffix.length) !== -1;
}

function r(max) {
  return Math.floor(Math.random() * max);
}

function parseCookies (request) {
  var list = {},
    rc = request.headers.cookie;

  rc && rc.split(';').forEach(function( cookie ) {
    var parts = cookie.split('=');
    list[parts.shift().trim()] = decodeURI(parts.join('='));
  });

  return list;
}

function getFileData(key, getFileData_callback) {
  var master_key = key;
  if (NOISY_DEBUG)  {
    console.log("getFileData called with " + key);
  }
  if (dbIsReady)  {
    if (NOISY_DEBUG)
      console.log("getFileData db is ready");
    db.get(key, function (err, doc, key) {
      if (NOISY_DEBUG)
        console.log("db.get callback, err=" + err + ", doc=" + doc + ", key=" + key);
      if (err) {
        if (NOISY_DEBUG)
          console.log("ERROR: oops, " + err + ", reading file info directly");
        // grab the data
        if (NOISY_DEBUG)
          console.log("KEY = " + master_key);
        storeFileData(master_key, getFileData_callback);
      } else {
        if (NOISY_DEBUG)
          console.log("Got data " + doc);
        var fileInfo = new Array();
        fileInfo[0] = new Date(doc.date);
        fileInfo[1] = doc.file_name;
        fileInfo[2] = doc.event_num;
        fileInfo[3] = doc.size;
        fileInfo[4] = doc.length;
        var stats = fs.statSync(VIDEOS_DIR + master_key)
        var fileSizeInBytes = stats["size"]
        if (fileSizeInBytes != doc.size)  {
            if (NOISY_DEBUG)
                console.log("ERROR: file " + master_key + " file size is different than cache, assuming it has changed");
            storeFileData(master_key, getFileData_callback, true);
        } else {
            if (NOISY_DEBUG)
              console.log("calling getFileData_callback with " + fileInfo);
            getFileData_callback(fileInfo);
        }
      }
    });
  } else {
    if (NOISY_DEBUG)
      console.log("ERROR: database not ready, reading file info directly");
    storeFileData(key, getFileData_callback);
  }
}

function storeFileData(key, storeFileData_callback, needs_deletion) {
  if (NOISY_DEBUG)
    console.log("at start of storeFileData, key=" + key);
  needs_deletion = typeof needs_deletion !== 'undefined' ? needs_deletion : false;
  var fileInfo = new Array();
  var eventNumber = key.substr(0, 2);
  var offset = new Date().getTimezoneOffset();
  var dateString = key.substr(3, key.indexOf(".avi")-3).replace(/\./g, ':') + createOffset(offset);
  var dateObject = new Date(dateString);
  var stats = fs.statSync(VIDEOS_DIR + key)
  var fileSizeInBytes = stats["size"]
  fileInfo[0] = dateObject;
  fileInfo[1] = key;
  fileInfo[2] = eventNumber;
  fileInfo[3] = fileSizeInBytes;
  if (NOISY_DEBUG)
    console.log("beginning async.series with fileInfo = " + fileInfo);
  async.series([
    function(seriesCallback) {
      if (typeof metalib != 'undefined')  {
        var metaobject = new metalib(VIDEOS_DIR + key);
      }
      if (NOISY_DEBUG)
        console.log("part 1, about to look up metadata");
      if (typeof metaobject != 'undefined') {
        if (NOISY_DEBUG)
          console.log("using metaobject.get()");
        metaobject.get(function(metadata, err) {
          if (!err)  {
            if (NOISY_DEBUG)
              console.log("got metadata");
              fileInfo[4] = metadata["durationsec"];
          } else {
            if (NOISY_DEBUG)
              console.log("couldn't get metadata, assuming 0s");
            fileInfo[4] = -1;
          }
          if (NOISY_DEBUG)
            console.log("about to call seriesCallback 1");
          seriesCallback(null, fileInfo);
        });
      } else {
        if (NOISY_DEBUG)
          console.log("using ffprobe()");
        ffmpeg.ffprobe(VIDEOS_DIR + key, function(err, metadata) {
          if (!err)  {
            if (NOISY_DEBUG) {
              console.log("got metadata!");
              console.dir(metadata);
            }
            var duration = Math.floor(metadata.format.duration);
            if (isNaN(duration))  {
              duration = -1;
            }
            console.log("duration = " + duration);
            fileInfo[4] = duration;
          } else {
            if (NOISY_DEBUG)
              console.log("couldn't get metadata, assuming 0s");
            fileInfo[4] = -1;
          }
          if (NOISY_DEBUG)
            console.log("about to call seriesCallback 1");
          seriesCallback(null, fileInfo);
        });
      }
    },
    function(seriesCallback) {
      // delete if desired
      if (needs_deletion)  {
        if (NOISY_DEBUG)
            console.log("need to delete " + key);
        // Remove our new document
        db.remove(key, function (err) {
          if (err) {
            console.log("ERROR attempting to delete " + key + ": " + err);
          }
          seriesCallback(null, fileInfo);
        });
      } else {
        seriesCallback(null, fileInfo);
      }
    },
    function(seriesCallback) {
      if (NOISY_DEBUG)
        console.log("part 2, about to write to database");
      // only try this if db is ready
      if (dbIsReady)  {
        if (NOISY_DEBUG)
          console.log("db is ready, writing");
        db.save(key, {
          date: fileInfo[0],
          file_name: fileInfo[1],
          event_num: fileInfo[2],
          size: fileInfo[3],
          length: fileInfo[4]
        }, function(err) {
          var responseMsg;
          var success;
          if (err)  {
            if (NOISY_DEBUG)
              console.log("ERROR WRITING TO DB: " + err);
          } else {
            if (NOISY_DEBUG)
              console.log("SUCCESS, wrote db");
          }
          if (NOISY_DEBUG)
            console.log("database write finished, calling seriesCallback 2");
          seriesCallback(null, fileInfo);
        });
      } else {
        if (NOISY_DEBUG)
          console.log("ERROR: database not ready, calling seriesCallback 2");
        seriesCallback(null, fileInfo);
      }
    }, function(seriesCallback) {
      if (NOISY_DEBUG)
        console.log("part 3, about to call final callback");
      storeFileData_callback(fileInfo);
      seriesCallback(null, fileInfo);
    }]);
}

function respondToHttpRequest(req, res) {
  var hostname = os.hostname();
  var host = req.headers["host"];
  var hostport = host
  var cookies = parseCookies(req);
  if (cookies["reverse_sort_order"])  {
    reverse_sort_order = parseInt(cookies["reverse_sort_order"]);
  }
  if(host.indexOf(":") > -1) {
    host = host.substring(0, host.indexOf(':'));
  }

  var ua = req.headers['user-agent'],
    $ = {};

  if (/mobile/i.test(ua))
    $.Mobile = true;

  if (/like Mac OS X/.test(ua)) {
    $.iOS = /CPU( iPhone)? OS ([0-9\._]+) like Mac OS X/.exec(ua)[2].replace(/_/g, '.');
    $.iPhone = /iPhone/.test(ua);
    $.iPad = /iPad/.test(ua);
  }

  if (/Android/.test(ua))
    $.Android = /Android ([0-9\.]+)[\);]/.exec(ua)[1];

  if (/webOS\//.test(ua))
    $.webOS = /webOS\/([0-9\.]+)[\);]/.exec(ua)[1];

  if (/(Intel|PPC) Mac OS X/.test(ua))
    $.Mac = /(Intel|PPC) Mac OS X ?([0-9\._]*)[\)\;]/.exec(ua)[2].replace(/_/g, '.') || true;

  if (/[Ll]inux/.test(ua))
    $.Linux = true;
 
  if (/Windows NT/.test(ua))
    $.Windows = /Windows NT ([0-9\._]+)[\);]/.exec(ua)[1];

  console.log("USER AGENT DETECTION RESULTS:");
  console.log($);

  //console.log("host = " + host);
  // console.log(url);
  var queryData = url.parse(req.url, true, true).query;
	console.log("Responding to http request: " + req.url);
  //console.log("query data: " + queryData);

  if (queryData.mode) {
    console.log("mode = " + queryData.mode);
    if (queryData.mode === "stop") {
      res.writeHead(200, "Content-Type: text/html");
      var rhtml = "<HTML><HEAD>"
                + "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no\" />"
                + "<TITLE>OSSS @ " + hostname + " - Stop"
                + "</TITLE></HEAD>"
                + "<BODY>"
                + "<H1>OSSS @ " + hostname + " - Stop</H1>";
      child = exec("/etc/init.d/motion stop", function (error, stdout, stderr) {
        if (error !== null || stdout.indexOf("none killed") > -1) {
          rhtml += "<p>Error stopping motion: " + stdout + "</p>";
        } else {
          rhtml += "<p>Motion has been successfully stopped.</p>";
        }
        rhtml += "<p><A HREF=\"http://" + hostport + "\">Back</A></p>"
               + "</BODY>"
               + "<FOOTER><HR><p>OSSS @ " + hostname + "</p></FOOTER>"
               + "</HTML>";
        res.end(rhtml);
      });
    } else if (queryData.mode === "start")  {
      res.writeHead(200, "Content-Type: text/html");
      var rhtml = "<HTML><HEAD>"
                + "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no\" />"
                + "<TITLE>OSSS @ " + hostname + " - Start"
                + "</TITLE></HEAD>"
                + "<BODY>"
                + "<H1>OSSS @ " + hostname + " - Start</H1>";
      child = exec("/etc/init.d/motion start", function (error, stdout, stderr) {
        if (error !== null || stdout.indexOf("Error") > -1) {
          rhtml += "<p>Error starting motion: " + stdout + "</p>";
        } else {
          rhtml += "<p>Motion has been successfully started.</p>";
        }
        rhtml += "<p><A HREF=\"http://" + hostport + "\">Back</A></p>"
               + "</BODY>"
               + "<FOOTER><HR><p>OSSS @ " + hostname + "</p></FOOTER>"
               + "</HTML>";
        res.end(rhtml);
      });
    } else if (queryData.mode === "live_view") {
      // <iframe src="http://www.w3schools.com"></iframe>
      res.writeHead(200, "Content-Type: text/html");
      var rhtml = "<HTML><HEAD>"
                + "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no\" />"
                + "<TITLE>OSSS @ " + hostname + " - Live View"
                + "</TITLE></HEAD>"
                + "<BODY>"
                + "<DIV ALIGN=\"CENTER\">"
                + "<H1>OSSS @ " + hostname + " - Live View</H1>";
      if ($.Android)  {
         //rhtml += "<A HREF=\"vlc://" + host + ":8080/\">Click here to view</A>.<br />(Requires the free VLC app for Android. <A HREF=\"https://play.google.com/store/apps/details?id=org.videolan.vlc.betav7neon&hl=en\">Download it here</A>.)</A>";
         rhtml += "<IMG WIDTH=\"" + WIDTH + "\" HEIGHT=\"" + HEIGHT + "\" SRC=\"http://" + host + ":8080\"></IMG>";
      } else if ($.iOS)  {
         //rhtml += "<A HREF=\"infuse://" + host + ":8080\">Click here to view</A>.<br />(Requires the free Infuse app.  <A HREF=\"https://itunes.apple.com/us/app/infuse-3/id577130046\">Download it here</A>.)</A>";
         rhtml += "<A HREF=\"vlc://http://" + host + ":8080/\">Click here to view</A>.<br />(Requires the free VLC app for iOS. <A HREF=\"http://get.videolan.org/vlc-iOS/2.3.0/vlc-iOS-2.3.0.ipa\">Download it here</A>.)</A>";
      } else {
         rhtml += "<IFRAME WIDTH=\"" + (WIDTH + PADDING) + "\" HEIGHT=\"" + (HEIGHT + PADDING) + "\" frameBorder=\"0\" seamless=\"seamless\" scrolling=\"no\" frameborder=\"0\" hspace=\"0\" vspace=\"0\" marginheight=\"0\" marginwidth=\"0\" SRC=\"http://" + host + ":8080\"></IFRAME>";
      }
         rhtml += "<P><A HREF=\"http://" + hostport + "/\">Back</A></p>"
                + "</DIV>"
                + "</BODY>"
                + "<FOOTER><HR><p>OSSS @ " + hostname + "</p></FOOTER>"
                + "</HTML>";
      res.end(rhtml);
    } else if (queryData.mode === "file_list")  {
      var headers = {"Content-Type": "text/html"};
      if (queryData.set_reverse_sort_order)  {
        reverse_sort_order = parseInt(queryData.set_reverse_sort_order);
        headers["Set-Cookie"] = "reverse_sort_order=" + queryData.set_reverse_sort_order; 
      }
      fs.readdir(VIDEOS_DIR, function(err, list) {
        if(err) {
          res.writeHead(200, headers);
          res.end("<HTML><HEAD><meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no\" /><TITLE>OSSS @ " + hostname + " - Error</TITLE></HEAD><BODY><h1>Error: unable to get file list: " + err + "</h1></BODY></HTML>");
        } else {
          res.writeHead(200, headers);
          res.write("<HTML><HEAD><meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no\" /><TITLE>OSSS @ " + hostname + " - Saved Recordings</TITLE></HEAD><BODY><h1>" + hostname + " - Saved Recordings</h1>");
          var regex = new RegExp(".*\.avi");
          var fileList = new Array()
          async.each(list, function(item, callback) {
            if(regex.test(item))  {
              getFileData(item, function(data) {
                if (NOISY_DEBUG)
                  console.log("in final value callback, adding data = " + data);
                fileList.push(data);
                callback();
              });
            } else {
              callback();
            }
          }, function(err)  {
            if (NOISY_DEBUG)  {
              console.log("DONE PROCESSING DIRECTORY LISTING");
              console.log("fileList = " + fileList);
            }
            if (fileList.length > 0)  {
              // sort by date
              fileList.sort(function(a,b){
                a = a[0];
                b = b[0];
                if (reverse_sort_order)  {
                  c = a > b ? -1 : a < b ? 1 : 0;
                } else {
                  c = a < b ? -1 : a > b ? 1 : 0;
                }
                return c;
              });
              res.write("<p>Current Sort Order: " + 
                (reverse_sort_order ? "Reverse" : "Forward") +
                " (<A HREF=\"http://" + hostport + "/?mode=file_list&set_reverse_sort_order=" + (reverse_sort_order ? "0" : "1") + "\">change</A>)</p>");
              res.write("<UL>");
              for (var i in fileList)  {
                var item = fileList[i];
                res.write("<LI>" + item[0].toLocaleDateString() + " @ " + formatAMPM(item[0]) + " (Event #" + item[2] + ") (" + humanFileSize(item[3], true) + (item[4] == -1 ? ", file still active" : (item[4] < 1 ? ", &lt;1s" : ", " + secondsToString(item[4], true))) + ")");
               if (item[4] != -1)  {
                res.write(" (<A HREF=\"http://" + hostport + "/?mode=view&filename=" + item[1] + ($.Linux && !$.Android ? "&use_vlc_plugin=true" : "") + "\">view</A>) (<A HREF=\"http://" + hostport + "/?mode=download&filename=" + item[1] + "\">download</A>) (<A HREF=\"http://" + hostport + "/?mode=delete&filename=" + item[1] + "\">delete</A>)");
               }
               res.write("</LI>");
              }
              res.end("</ul><h3><A HREF=\"http://" + hostport + "/?mode=delete&filename=ALL\">Delete ALL Videos</A></h3><p><A HREF=\"http://" + hostport + "/\">Back</A></p></BODY><FOOTER><HR><p>OSSS @ " + hostname + "</p></FOOTER></HTML>");
            } else {
              res.write("<h3>No Files Found</h3>");
              res.end("<p><A HREF=\"http://" + hostport + "/\">Back</A></p></BODY><FOOTER><HR><p>OSSS @ " + hostname + "</p></FOOTER></HTML>");
            }
          });
        }
      });
    } else if (queryData.mode === "delete")  {
      if (queryData.filename)  {
        var filename = queryData.filename;
        if (queryData.confirmed)  {
          var confirmed = queryData.confirmed;
          var rhtml = "<HTML><HEAD>"
                    + "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no\" />"
                    + "<TITLE>OSSS @ " + hostname + " - Delete File(s)"
                    + "</TITLE></HEAD>"
                    + "<BODY>"
                    + "<H1>OSSS @ " + hostname + " - Delete File(s)</H1>"
                    + "<p><h3>";
          if (confirmed === "yes")  {
            var numDeleted = 0;
            var numErrors = 0;
            var path = VIDEOS_DIR;
            if (filename === "ALL")  {
              var files = fs.readdirSync(path);
              var success = true
              // nuke the database
              // db.clear(function(err) {
              //     if (NOISY_DEBUG)
              //       console.log("DATABASE NUKED");
              // });
              files.forEach(function(file) {
                if (file.match("^.*avi$"))  {
                  try {
                    fs.unlinkSync(path + file);
                    numDeleted++;
                    rhtml += "Deleted \"" + file + "\"<br />";
                  } catch (ex) {
                    numErrors++;
                    rhtml += "Could not delete \"" + file + "\": " + ex + "<br />";
                    success = false
                  }
                }
              });
              rhtml += "<br />";
            } else {
              path += filename;
              try {
                fs.unlinkSync(path);
                numDeleted++;
                success = true;
              } catch (ex) {
                numErrors++;
                rhtml += "Could not delete \"" + filename + "\": " + ex + "<br /><br />";
                success = false;
              }
            }
            if (success)  {
              rhtml += numDeleted + " file" + (numDeleted > 1 ? "s" : "") + " deleted successfully.";
            } else {
              rhtml += numDeleted > 0 ? numDeleted + " file" + (numDeleted > 1 ? "s" : "") + " deleted successfully." : "";
              rhtml += numErrors + " delete failure" + (numErrors > 1 ? "s" : "") + ".";
            }
          } else {
            rhtml += "Delete cancelled.";
          }
             rhtml += "<h3><A HREF=\"" + hostport + "/?mode=file_list\">OK</A></h3></p>"
                    + "</BODY>"
                    + "<FOOTER><HR><p>OSSS @ " + hostname + "</p></FOOTER>"
                    + "</HTML>";
          res.end(rhtml);
        } else {
          var rhtml = "<HTML><HEAD>"
                    + "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no\" />"
                    + "<TITLE>OSSS @ " + hostname + " - Delete File(s)"
                    + "</TITLE></HEAD>"
                    + "<BODY>"
                    + "<H1>OSSS @ " + hostname + " - Delete File(s)</H1>"
                    + "<p><h3>You are about to delete "
                    + (filename === "ALL" ? "ALL videos!" : "\"" + filename + "\"")
                    + "<br /><br />"
                    + "Are you SURE you want to do this?<br /><br />"
                    + "<A HREF=\"" + hostport + "/?mode=delete&filename=" + filename + "&confirmed=yes\">YES</A> <A HREF=\"" + hostport + "/?mode=delete&filename=" + filename + "&confirmed=no\">NO</A></h3></p>"
                    + "</BODY>"
                    + "<FOOTER><HR><p>OSSS @ " + hostname + "</p></FOOTER>"
                    + "</HTML>";
          res.end(rhtml);
        }
      } else {
        res.writeHead(200, "Content-Type: text/html");
        res.end("<HTML><HEAD><meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no\" /><TITLE>OSSS @ " + hostname + " - Error</TITLE></HEAD><BODY><h1>Error: filename not specified.</h1></BODY></HTML>");
      }
    } else if (queryData.mode === "view")  {
      if (queryData.filename)  {
        var filename = queryData.filename;
        var filePath = VIDEOS_DIR + filename;
        fs.exists(filePath, function(exists) {
          if (exists) {
            console.log('viewing contents of local file: ' + filePath);
            var stat = fs.statSync(filePath);
            res.writeHead(200, {
              'Content-Type': 'text/html'
            });
            var rhtml = "<HTML><HEAD>"
                      + "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no\" />"
                      + "<TITLE>OSSS @ " + hostname + " - Video Playback - " + filename
                      + "</TITLE></HEAD>"
                      + "<BODY>"
                      + "<DIV ALIGN=\"CENTER\">"
                      + "<H1>OSSS @ " + hostname + " - " + filename + "</H1>";
            if (queryData.use_vlc_plugin)  {
               rhtml += "<embed type=\"application/x-vlc-plugin\""
                      + "pluginspage=\"http://www.videolan.org\""
                      + "name=\"video1\""
                      + "id=\"video1\""
                      + "controls=\"yes\" toolbar=\"yes\" autoplay=\"no\" loop=\"yes\" width=\"" + WIDTH + "\" height=\"" + HEIGHT + "\""
                      + "target=\"http://" + hostport + "/?mode=download&filename=" + filename + "\" />"
                      + "<br />"
                      + "(Note: if you don't see a video window above, then you must <A HREF=\"http://www.videolan.org/vlc/download-ubuntu.html\">install the VLC browser plugin</A>.)"
                      + "<br />";
                      /*
                      + "<a href=\"javascript:;\" onclick='document.video1.play()'>[Play]</a> "
                      + "<a href=\"javascript:;\" onclick='document.video1.pause()'>[Pause]</a> "
                      + "<a href=\"javascript:;\" onclick='document.video1.stop()'>[Stop]</a> "
                      + "<a href=\"javascript:;\" onclick='document.video1.fullscreen()'>[fullscreen]</a>";
                      */
            } else {
              if ($.Android)  {
                //rhtml += "<A HREF=\"vlc://" + hostport + "/?mode=download&filename=" + filename + "\">Tap here to play this video</A>.<br />(Requires the free VLC app for Android. <A HREF=\"https://play.google.com/store/apps/details?id=org.videolan.vlc.betav7neon&hl=en\">Download it here</A>.)";
                rhtml += "<A HREF=\"http://" + hostport + "/?mode=download&filename=" + filename + "\">Tap here to download this file</A>.<br />Once the file is downloaded, swipe down Notification Center, and tap on the file to open it in VLC. (Requires the free VLC app for Android. <A HREF=\"https://play.google.com/store/apps/details?id=org.videolan.vlc.betav7neon&hl=en\">Download it here</A>.)";
                rhtml += "<br />Note #2: you may get an error message saying VLC encounterd an error with this media.  If so, tap the \"Refresh\" (two arrows going around in circles) button in VLC, and the downloaded file should appear.  Seems to be a bug with the latest VLC, they broke it. :-P";
              } else if ($.iOS)  {
                rhtml += "<A HREF=\"vlc://http://" + hostport + "/?mode=download&filename=" + filename + "\">Tap here to play this video</A>.<br />(Requires the free VLC app for iOS. <A HREF=\"http://get.videolan.org/vlc-iOS/2.3.0/vlc-iOS-2.3.0.ipa\">Download it here</A>.)";
                //rhtml += "<A HREF=\"infuse://" + hostport + "/?mode=download&filename=" + filename + "\">Tap here to play this video</A>.<br />(Requires the free Infuse app. <A HREF=\"https://itunes.apple.com/us/app/infuse-3/id577130046?mt=8\">Download it here</A>.)";
              } else {
               rhtml += "<video width=\"" + WIDTH + "\" height=\"" + HEIGHT + "\" controls>"
                      + "<source src=\"http://" + hostport + "/?mode=download&filename=" + filename + "\" type=\"video/x-msvideo\">"
                      + "Your browser does not support the video tag."
                      + "</video>"
                      + "<br />";
                      // + "<A HREF=\"http://" + hostport + "/?mode=view&filename=" + filename + "&use_vlc_plugin=true\">(Don't see any video?  Try this...)</A>";
              }
           }
               rhtml += "<P><A HREF=\"http://" + hostport + "/?mode=file_list\">Back</A></p>"
                      + "</DIV>"
                      + "</BODY>"
                      + "<FOOTER><HR><p>OSSS @ " + hostname + "</p></FOOTER>"
                      + "</HTML>";
            res.end(rhtml);
          } else {
            console.log('returning 404, could not find: ' + filePath);
            res.writeHead(404);
            res.end('Not found.  Go away kid, you\'re bothering me.');
          }
        });
      } else {
        res.writeHead(200, "Content-Type: text/html");
        res.end("<HTML><HEAD><meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no\" /><TITLE>OSSS @ " + hostname + " - Error</TITLE></HEAD><BODY><h1>Error: filename not specified.</h1></BODY></HTML>");
      }
    } else if (queryData.mode === "download")  {
      if (queryData.filename)  {
        var filename = queryData.filename;
        var filePath = VIDEOS_DIR + filename;
        fs.exists(filePath, function(exists) {
          if (exists) {
            console.log('sending contents of local file: ' + filePath);
            var stat = fs.statSync(filePath);
            var contenttype = "video/x-msvideo";
            res.writeHead(200, {
              'Content-Type': contenttype,
              'Content-Length': stat.size,
              'Content-Disposition': "attachment; filename=" + filename
            });
            var readStream = fs.createReadStream(filePath);
            readStream.pipe(res);
          } else {
            console.log('returning 404, could not find: ' + filePath);
            res.writeHead(404);
            res.end('Not found.  Go away kid, you\'re bothering me.');
          }
        });
      } else {
        res.writeHead(200, "Content-Type: text/html");
        res.end("<HTML><HEAD><meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no\" /><TITLE>OSSS @ " + hostname + " - Error</TITLE></HEAD><BODY><h1>Error: filename not specified.</h1></BODY></HTML>");
      }
    }
  } else {
    // send the index page
    console.log("Responding with index page");
    check_motion_state(function(is_running, pid) {
      res.writeHead(200, "Content-Type: text/html");
      var rhtml = "<HTML>"
                + "<HEAD>"
                + "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no\" />"
                + "<TITLE>OSSS (Open Source Surveillance and Security) - " + hostname + "</TITLE>"
                + "</HEAD>"
                + "<BODY>"
                + "<p><h1>OSSS (Open Source Surveillance and Security) - " + hostname + "</h1></p>"
                + "<p>";
      if (is_running)  {
          rhtml += "<p>State: RUNNING (pid = " + pid + ") (<A HREF=\"http://" + hostport + "/?mode=stop\">stop</A>)</p>"
                + "<ul>"
                + "<li><A HREF=\"http://" + hostport + "/?mode=live_view\">Live View</A></li>";
      } else {
        if (pid == -1)  {
              rhtml += "<p>State: UNKNOWN</p>"
                    + "<ul>"
                    + "<li><A HREF=\"http://" + hostport + "/?mode=live_view\">Live View</A> (note: may be unavailable if process is not running)</li>";
        } else {
              rhtml += "<p>State: STOPPED (<A HREF=\"http://" + hostport + "/?mode=start\">start</A>)</p>"
                    + "<ul>"
                    + "<li><i>Live View is unavailable while motion is stopped.</i></A></li>";
        }
      }
      rhtml += "<li><A HREF=\"http://" + hostport + "/?mode=file_list\">Saved Recordings</A></li>"
             + "</UL>"
             + "</BODY>"
             + "<FOOTER><HR><p>OSSS @ " + hostname + "</p></FOOTER>"
             + "</HTML>";
      res.end(rhtml);
    });
	}
}

// Initialize database
var cache_filename = '/tmp/dir_cache';
if (DEBUG)
  cache_filename = '/tmp/dir_cache.debug';
var db = nStore.new(cache_filename, function () {
  console.log('Database initialization complete.');
  dbIsReady = true;
});
db.filterFn = function (doc, meta) {
  //return doc.lastAccess > Date.now() - 360000;
  return doc.lastAccess > Date.now() - 1;
};

// Set up the HTTP listener
var server = http.createServer(function (req, res) {
  respondToHttpRequest(req, res);
}).listen(PORT);
server.on('connection', function(sock) {
  console.log('Incoming HTTP connection from ' + sock.remoteAddress);
});
console.log('HTTP server running on port ' + PORT + '.');
