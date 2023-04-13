"use strict";
var showDebug = false;

var partyId = 'Q0Q6cUlBOExyZ20=';
var cdnServerUrl = 'https://cdn.smrt-content.com/prod';
var apiServerUrl = 'https://theseoffersforyou.com';
var swScope = '/';
var customWorkerJS = 'service-worker.js';

var pushConfig = {
    trackData: {
        statParams: ['country', 'city', 'cid'],
        urlParams: ['s1', 's2', 's3', 's4', 'ref', 'eauuid', 'tid', 'revenue'],
        device: ['maker', 'model']
    },
    sid: '',
    urls: {
        conversion: '',
        denied: '',
        success: '',
    }
};
var indexedDBConfig = {
    baseName: "subscriberData",
    storeName: "subscriberData",
    storedDataMap: new Map(),
    version: 2
};
var indexedDBFCMConfig = {
    baseName: "fcm_token_details_db",
    storeName: "fcm_token_object_Store",
    storedDataMap: new Map(),
    version: 1
};

var pushLoopDomains = {
    domains: [],
    redirectUrl: ""
};

var	messageBody = {
    info: {}
};

function logger(message) {
    showDebug && console.log(message);
};

firebase.initializeApp({"messagingSenderId": "353793449981"});
var messaging = firebase.messaging();

var loadScriptAsync = function(uri) {
    return new Promise((resolve, reject) => {
        var tag = document.createElement('script');
        tag.src = uri;
        tag.async = true;
        tag.onload = () => {
            resolve();
        };
        var firstScriptTag = document.getElementsByTagName('script')[0];
        firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
    });
};

var scriptLoaded = loadScriptAsync(cdnServerUrl + '/push-utils.js');

scriptLoaded.then(function(){
    if (document.readyState !== "loading") {
        subscribe();
    } else {
        document.addEventListener("DOMContentLoaded", subscribe);
    }

    function subscribe() {
        //Try load custom parameters from index page
        pushConfig.urls.conversion = typeof conversionUrl !== 'undefined' ? conversionUrl : '';
        pushConfig.urls.denied = typeof deniedUrl !== 'undefined' ? deniedUrl : '';
        pushConfig.urls.success = typeof successUrl !== 'undefined' ? successUrl : '';
        messageBody['content'] = window.location.hostname;
        messageBody['info']['browser'] = getBrowserInfo();
        messageBody['browser'] = getBrowserInfo().browser;
        messageBody['info']['system'] = getSystemInfo();
        messageBody['info']['language'] = getLanguage();
        messageBody['info']['resolution'] = getResolution();
        messageBody['info']['device'] = getDeviceType();
        var urlParams = getTrackData();
        if (urlParams) {
            messageBody['cid'] = resolveCid(urlParams.cid, urlParams.pid);
            messageBody['urlParams'] = urlParams;
        }
        if (isWrongBrowser()) {
            logger("Push isn't supported on this browser, disable or hide UI");
            window.location = pushConfig.urls.denied;
        } else if ('PushManager' in window) {
            navigator.serviceWorker.register(window.location.origin + swScope + customWorkerJS, { scope: swScope }).then(function (registration) {
                messaging.useServiceWorker(registration);
                if (Notification.permission !== 'granted') {
                    messaging.requestPermission()
                        .then(function () {
                            logger('Notification permission granted.');
                            return messaging.getToken();
                        }).then(tokenResolveSuccessfuly)
                        .catch(function (err) {
                            if (err.code === "messaging/token-subscribe-failed" && err.message === "Requested entity was not found.") {
                                getAndRefreshToken();
                            }
                            subscriptionFailed('Unable to get permission to notify. '+ 'Error ' + err.name + ':' + err.message);
                        });
                } else {
                    getAndRefreshToken();
                }
            }).catch(function (err) {
                subscriptionFailed('Registration failed. '+ 'Error ' + err.name + ':' + err.message);
            });
        } else {
            subscriptionFailed('Push messaging is not supported');
        }
    }

    function tokenResolveSuccessfuly(token) {
        logger('Token: ' + token);
        if (pushConfig.urls.conversion) {
            sendConversion(replaceUrl(pushConfig.urls.conversion, messageBody['urlParams']));
        }
        return sendMessage('new', token);
    };

    function loadDataFromDBAndRefresh(currentToken) {
        loadDataFromDBToMap(indexedDBFCMConfig)
            .then(function (reponse) {
                loadDataFromDBPush(currentToken);
            }).catch(function(err) {
            var newVer = err.srcElement? parseNewVersion(err.srcElement.error.message) : indexedDBFCMConfig.version+1;
            if (newVer < 0 || newVer > 3) {
                loadDataFromDBPush(currentToken);
            } else {
                indexedDBFCMConfig.version = newVer;
                loadDataFromDBToMap(indexedDBFCMConfig).then(function (reponse) {
                    loadDataFromDBPush(currentToken);
                })
            }
        });
    }

    function loadDataFromDBPush(currentToken) {
        loadDataFromDBToMap(indexedDBConfig)
            .then(function (reponse) {
                refreshTokenOnServer(currentToken);
            }).catch(function(err) {
            logger(err);
            refreshTokenOnServer(currentToken);
        });
    }

    function refreshTokenOnServer(currentToken) {
        if (!indexedDBConfig.storedDataMap.has("sid") ) {
            sendMessage('new', currentToken);
        } else if ( (indexedDBConfig.storedDataMap.has("token") && indexedDBFCMConfig.storedDataMap.has("fcmToken") &&
            indexedDBConfig.storedDataMap.get("token") !== indexedDBFCMConfig.storedDataMap.get("fcmToken")
            || !indexedDBConfig.storedDataMap.has("token")))
        {
            messageBody['sid'] = indexedDBConfig.storedDataMap.get("sid");
            sendMessage('refresh', currentToken);
        } else {
            subscriptionSuccess();
        }
    }

    function getAndRefreshToken() {
        messaging.getToken().then(function (refreshedToken) {
            loadDataFromDBAndRefresh(refreshedToken);
        }).catch(function (err) {
            subscriptionFailed('Unable to retrieve refreshed token. '+ 'Error ' + err.name + ':' + err.message);
        });
    }

    messaging.onTokenRefresh(getAndRefreshToken);

    function sendMessage(eventType, token) {
        var clickPixelUrl = typeof soClickPixelUrl !== 'undefined' ? soClickPixelUrl : '';
        fetch(clickPixelUrl)
        .then((resp) => resp.json())
            .then(function(data) {
                var reqId = data.reqid || '';
                return sendMessageToServer(eventType, token, reqId);
            }).catch(function(e) {
                  console.log(e);
                  logger("Error get reqId: ", e);
                  return sendMessageToServer(eventType, token, '');
            });
    }

    function sendMessageToServer(eventType, token, reqId) {
        console.log("reqId:" + reqId + " eventType: " + eventType + " token: " + token);
        messageBody['tokenId'] = token;
        if (notBlank(typeof dmpSegments !== 'undefined' && dmpSegments)) {
            messageBody['segments'] = dmpSegments.split(',');
        }

        messageBody['urlParams'].s2 = reqId;

        return fetch(apiServerUrl + '/api/subscribe/' + eventType, {
            method: 'post',
            headers: {
                'Content-type': 'application/json',
                'Authorization': 'Basic ' + partyId
            },
            body: JSON.stringify(messageBody)
        }).then(function (response) {
            if (response.status !== 200) {
                throw new Error("Error Send Subscription To Server");
            }
            return response.json();
        }).then(function (data) {
            logger('Response Received: ', data);
            pushConfig.sid = data.sid;
            if (data.urlParams !== undefined) {
                addDataToDB(data, data.sid, token, reqId);
            }
            if (data.sid) {
                messageBody['urlParams'].sid = data.sid;
                setCookie("sid_" + getSubdomain(), data.sid);
                cookieMatching(data.sid);
                subscriptionSuccess();
            } else {
                subscriptionFailed("SubscriberId is undefined.");
            }
        }).catch(function (e) {
            logger("Error Send Subscription To Server: ", e);
        });
    }

    function cookieMatching(sid) {
        $('<img />').attr({
            'id': 'myImage' + sid,
            'src': 'https://statisticresearch.com/match?p=PS&adxguid=' + sid,
            'width': 1,
            'height': 1
        }).appendTo('body');
    }

    function connectDB(f) {
        //Open the database
        logger("Connecting to DB...");
        var request = indexedDB.open(indexedDBConfig.baseName, indexedDBConfig.version);
        request.onerror = logger;
        request.onsuccess = function() {
            logger("Connection to the database was successful");
            f(request.result);
        }
        request.onupgradeneeded = function (event) {
            var thisDB = event.target.result;
            if(!thisDB.objectStoreNames.contains(indexedDBConfig.baseName)) {
                var store = event.currentTarget.result.createObjectStore(indexedDBConfig.storeName, {autoIncrement: true});
                var indexNames = pushConfig.trackData.statParams.concat(pushConfig.trackData.urlParams).concat(pushConfig.trackData.device);
                // Creating indexes
                indexNames.forEach(function (key) {
                    store.createIndex(key, key, {unique: false});
                });
                logger("Indexes in DB created 1");
            }
            connectDB(f);
        };

    }

    function putData(data) {
        connectDB(function(db){
            var request = db.transaction(indexedDBConfig.storeName, "readwrite").objectStore(indexedDBConfig.storeName).put(data);
            // var objectStoreRequest = objStore.clear();
            request.onsuccess = function() {
                logger("Putting data to db...");
                return request.result;
            };
            request.onerror = logger;
        });
    }

    function addDataToDB(data, sid, token, s2) {
        var newItem = {};
        pushConfig.trackData.statParams.forEach(function(key) {
            newItem[key] = data[key] || '';
        });
        pushConfig.trackData.urlParams.forEach(function(key) {
            newItem[key] = data.urlParams[key] || '';
        });
        pushConfig.trackData.device.forEach(function(key) {
            newItem[key] = data.device[key] || '';
        });
        newItem['s2'] = s2 || '';
        newItem['sid'] = sid || '';
        newItem['token'] = token || '';
        newItem['createTime'] = new Date().getTime();
        putData(newItem);
    };

    function createIndexes(event) {
        var store = event.currentTarget.result.createObjectStore(indexedDBConfig.storeName, {autoIncrement: true});
        var indexNames = pushConfig.trackData.statParams.concat(pushConfig.trackData.urlParams).concat(pushConfig.trackData.device);
        // Creating indexes
        indexNames.forEach(function (key) {
            store.createIndex(key, key, {unique: false});
        });
        logger("Indexes in DB created 2");
    }

    function loadDataFromDBToMap(dbConfig) {
        logger('Loading Data FromDB: ' + dbConfig.baseName);
        return new Promise(function (resolve, reject) {
            var request = indexedDB.open(dbConfig.baseName, dbConfig.version);
            request.onupgradeneeded = function(event) {
                logger('Resolve onupgradeneeded: ' + dbConfig.baseName);
                if (dbConfig.baseName === indexedDBConfig.baseName) {
                    createIndexes(event);
                }
                resolve(event);
            };
            request.onsuccess = function (event) {
                var db = event.target.result;
                try {
                    var transaction = db.transaction([dbConfig.storeName], 'readonly');
                    var objectStore = transaction.objectStore(dbConfig.storeName);
                    objectStore.openCursor(null, 'prev').onsuccess = function (event) {
                        var cursor = event.target.result;
                        if (cursor) {
                            for (var field in cursor.value) {
                                if (cursor.value[field] !== undefined && cursor.value[field] !== null) {
                                    dbConfig.storedDataMap.set(field, cursor.value[field]);
                                }
                            }
                        }
                        logger('Resolve onsuccess: ' + dbConfig.baseName);
                        resolve(event);
                    }
                } catch(e) {
                    logger('Database ' + dbConfig.baseName +' is not exist!');
                    logger('Error ' + e.name + ":" + e.message);
                    resolve(event);
                }
            };
            request.onerror = function(err) {
                logger(err);
                reject(err);
            };
        })
    };
    // IndexedDB END

    function getTrackData() {
        var pageAttributes = (typeof _push.urlParams !== 'undefined' && _push.urlParams) ? JSON.parse(JSON.stringify(_push.urlParams)) : {};
        var trackData = {};
        if (pageAttributes) {
            Object.keys(pageAttributes).forEach(function (key) {
                var value = pageAttributes[key];
                logger(key + ': ' + value);
                if ((typeof value !== 'undefined') && key !== 's2') {
                    trackData[key] = value;
                }
            });
        }
        logger("TrackData: ");
        Object.keys(trackData).forEach(function (key) {
            logger(key + ': ' + trackData[key]);
        });
        return trackData;
    }

    function subscriptionSuccess() {
        logger("Subscription Success.");
        if (isExternalPush()) {
            closePopup();
        } else if (notBlank(pushConfig.urls.success)) {
            logger("Redirect to successUrl: " + replaceUrl(pushConfig.urls.success, messageBody['urlParams']));
            window.location = replaceUrl(pushConfig.urls.success, messageBody['urlParams']);
        }
    }

    function subscriptionFailed(err) {
        logger(err);
        if (typeof pushLoopDomains !== 'undefined' && pushLoopDomains.domains.length > 0) {
            var index = pushLoopDomains.domains.indexOf(window.location.hostname);
            if (index > -1) {
                var urlParsed = parseURL(window.location.href);
                var loopCounter = urlParsed.params && urlParsed.params.count ? urlParsed.params.count.split(',') : [];
                if (loopCounter.length < pushLoopDomains.domains.length) {
                    var nexIndex = index + 1 == pushLoopDomains.domains.length ? 0 : index + 1;
                    if (urlParsed.params) {
                        var newParams = "?";
                        Object.keys(urlParsed.params).forEach(function (key) {
                            var val = key == 'count' ? urlParsed.params[key] + "," + index : urlParsed.params[key];
                            newParams += "&" + key + "=" + val;
                        });
                        if (!urlParsed.params.hasOwnProperty('count')) {
                            newParams += "&count=" + index;
                        }
                        newParams = newParams.replace("?&", "?");
                    }
                    var location_href = window.location.href;
                    if (window.location.href.indexOf('?') > -1) {
                        location_href = window.location.href.substring(0, window.location.href.indexOf('?'));
                    }
                    window.location = location_href.replace(pushLoopDomains.domains[index], pushLoopDomains.domains[nexIndex]) + newParams;
                } else {
                    window.location = replaceUrl(pushLoopDomains.redirectUrl, messageBody['urlParams']);
                }
            } else {
                redirectLogic();
            }
        } else {
            redirectLogic();
        }
    };

    function redirectLogic() {
        if (isExternalPush()) {
            closePopup();
        } else if (notBlank(pushConfig.urls.denied)) {
            logger("Push Subscription Failed. Redirect to deniedUrl: ", replaceUrl(pushConfig.urls.denied, messageBody['urlParams']));
            window.location = replaceUrl(pushConfig.urls.denied, messageBody['urlParams']);
        }
    }

    function isExternalPush() {
        return notBlank(messageBody.urlParams.ext) && messageBody.urlParams.ext == '1';
    }

    function parseNewVersion(erroMessage) {
        if (!notBlank(erroMessage)) {
            return -1;
        }
        var result = erroMessage.match(/\([0-9]\)/gi);
        if (!notBlank(result) || result.length !== 2) {
            return -1;
        }
        var verNew = result[1].match(/[0-9]/gi);
        if (!isNaN(parseInt(verNew))) {
            return parseInt(verNew);
        }
        return -1;
    }

});

function defaultIfEmpty(item, defaultItem) {
    return (typeof item !== 'undefined' && item !== undefined && item) ? item : defaultItem;
}

function notBlank(item) {
    return item !== undefined && item !== null && item != '';
}