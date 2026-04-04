(function () {
  "use strict";

  const STORAGE_KEYS = {
    waitTimes: "tdsWaitTimes",
    selectedAttractions: "tdsSelectedAttractions",
    locationFallback: "tdsLocationFallback",
    lastKnownPosition: "tdsLastKnownPosition"
  };

  const WAIT_STEP = 15;
  const WAIT_WEIGHT = 1.0;
  const TRAVEL_WEIGHT = 1.25;
  const UNKNOWN_WAIT_PENALTY = 45;

  const AREA_CODE_MAP = {
    "メディテレーニアンハーバー": "MH",
    "アメリカンウォーターフロント": "AW",
    "ポートディスカバリー": "PD",
    "ファンタジースプリングス": "FS",
    "ロストリバーデルタ": "LR",
    "アラビアンコースト": "AC",
    "マーメイドラグーン": "ML",
    "ミステリアスアイランド": "MI"
  };

  const AREA_TRAVEL_MINUTES = {
    CENTER: { MH: 10, AW: 12, PD: 10, FS: 18, LR: 12, AC: 12, ML: 10, MI: 6 },
    MH: { MH: 6, AW: 8, PD: 12, FS: 20, LR: 22, AC: 18, ML: 12, MI: 10 },
    AW: { MH: 8, AW: 6, PD: 8, FS: 25, LR: 22, AC: 22, ML: 20, MI: 15 },
    PD: { MH: 12, AW: 8, PD: 6, FS: 18, LR: 15, AC: 20, ML: 25, MI: 10 },
    FS: { MH: 20, AW: 25, PD: 18, FS: 6, LR: 10, AC: 8, ML: 12, MI: 15 },
    LR: { MH: 22, AW: 22, PD: 15, FS: 10, LR: 6, AC: 8, ML: 12, MI: 12 },
    AC: { MH: 18, AW: 22, PD: 20, FS: 8, LR: 8, AC: 6, ML: 8, MI: 12 },
    ML: { MH: 12, AW: 20, PD: 25, FS: 12, LR: 12, AC: 8, ML: 6, MI: 10 },
    MI: { MH: 10, AW: 15, PD: 10, FS: 15, LR: 12, AC: 12, ML: 10, MI: 6 }
  };

  const AREA_DISPLAY_NAMES = Object.keys(AREA_CODE_MAP).reduce(function (result, key) {
    result[AREA_CODE_MAP[key]] = key;
    return result;
  }, {});

  const AREA_CENTERS = {
    MH: { lat: 35.6260, lng: 139.8818 },
    AW: { lat: 35.6287, lng: 139.8828 },
    PD: { lat: 35.6294, lng: 139.8868 },
    FS: { lat: 35.6257, lng: 139.8897 },
    LR: { lat: 35.6274, lng: 139.8883 },
    AC: { lat: 35.6253, lng: 139.8876 },
    ML: { lat: 35.6248, lng: 139.8853 },
    MI: { lat: 35.6266, lng: 139.8839 }
  };

  const UNAVAILABLE_ATTRACTION_IDS = new Set([
    "attr-221-ml",
    "attr-222-lrd",
    "attr-235-ac",
    "attr-224-mi"
  ]);

  const UNAVAILABLE_RESTAURANT_IDS = new Set([
    "rest-425-aw",
    "rest-429-aw",
    "rest-426-aw"
  ]);

  const LANDMARK_CHOICES = [
    { id: "attr-230-mh", label: "メディテレーニアンハーバー / ヴェネツィアン・ゴンドラ付近" },
    { id: "attr-243-aw", label: "アメリカンウォーターフロント / タワー・オブ・テラー付近" },
    { id: "attr-234-pd", label: "ポートディスカバリー / アクアトピア付近" },
    { id: "attr-255-fs", label: "ファンタジースプリングス / アナとエルサのフローズンジャーニー付近" },
    { id: "attr-222-lrd", label: "ロストリバーデルタ / インディ・ジョーンズ・アドベンチャー付近" },
    { id: "attr-220-ac", label: "アラビアンコースト / ジャスミンのフライングカーペット付近" },
    { id: "attr-202-ml", label: "マーメイドラグーン / アリエルのプレイグラウンド付近" },
    { id: "attr-223-mi", label: "ミステリアスアイランド / センター・オブ・ジ・アース付近" }
  ];

  const state = {
    attractions: Array.isArray(window.TDS_ATTRACTIONS) ? window.TDS_ATTRACTIONS.slice() : [],
    restaurants: Array.isArray(window.TDS_RESTAURANTS) ? window.TDS_RESTAURANTS.slice() : [],
    waitTimes: loadStoredObject(STORAGE_KEYS.waitTimes, {}),
    selectedAttractions: loadStoredArray(STORAGE_KEYS.selectedAttractions),
    fallback: loadStoredObject(STORAGE_KEYS.locationFallback, null),
    lastKnownPosition: loadStoredObject(STORAGE_KEYS.lastKnownPosition, null),
    gps: {
      status: "idle",
      position: null,
      errorMessage: ""
    },
    activeTab: "attractions"
  };

  const attractionMap = new Map(state.attractions.map(function (item) {
    return [item.id, item];
  }));

  const refs = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    cacheElements();
    if (!state.attractions.length || !state.restaurants.length) {
      document.body.innerHTML = "<main class=\"app-shell\"><section class=\"panel\"><h1>Data not found</h1><p>attractions.js または restaurants.js を読み込めませんでした。</p></section></main>";
      return;
    }

    state.selectedAttractions = state.selectedAttractions.filter(function (id) {
      return attractionMap.has(id);
    });

    populateSelect(refs.attractionAreaFilter, [{ value: "", label: "すべて" }].concat(
      uniqueValues(state.attractions.map(function (item) { return item.area; })).map(function (area) {
        return { value: area, label: area };
      })
    ));

    populateSelect(refs.attractionDisplayFilter, [{ value: "", label: "すべて" }].concat(
      uniqueValues(state.attractions.map(function (item) {
        return item.displayCategory || "";
      }).filter(Boolean)).map(function (category) {
        return { value: category, label: category };
      })
    ));

    populateSelect(refs.restaurantAreaFilter, [{ value: "", label: "すべて" }].concat(
      uniqueValues(state.restaurants.map(function (item) { return item.area; })).map(function (area) {
        return { value: area, label: area };
      })
    ));

    populateSelect(refs.restaurantCategoryFilter, [{ value: "", label: "すべて" }].concat(
      uniqueValues(state.restaurants.map(function (item) { return item.category; })).map(function (category) {
        return { value: category, label: category };
      })
    ));

    populateSelect(refs.fallbackLandmarkSelect, LANDMARK_CHOICES.map(function (choice) {
      return { value: choice.id, label: choice.label };
    }));

    if (state.fallback && state.fallback.type === "landmark" && state.fallback.attractionId) {
      refs.fallbackLandmarkSelect.value = state.fallback.attractionId;
    }

    bindEvents();
    renderAll();
    requestGpsLocation();
  }

  function cacheElements() {
    refs.attractionsList = document.getElementById("attractions-list");
    refs.restaurantsList = document.getElementById("restaurants-list");
    refs.rankingList = document.getElementById("ranking-list");
    refs.rankingSummary = document.getElementById("ranking-summary");
    refs.locationStatus = document.getElementById("location-status");
    refs.locationModeBanner = document.getElementById("location-mode-banner");
    refs.fallbackPanel = document.getElementById("fallback-panel");
    refs.fallbackLandmarkSelect = document.getElementById("fallback-landmark-select");
    refs.attractionSearch = document.getElementById("attraction-search");
    refs.attractionAreaFilter = document.getElementById("attraction-area-filter");
    refs.attractionDisplayFilter = document.getElementById("attraction-display-filter");
    refs.restaurantSearch = document.getElementById("restaurant-search");
    refs.restaurantAreaFilter = document.getElementById("restaurant-area-filter");
    refs.restaurantCategoryFilter = document.getElementById("restaurant-category-filter");
    refs.restaurantRecommendation = document.getElementById("restaurant-recommendation");
    refs.attractionsCount = document.getElementById("attractions-count");
    refs.restaurantsCount = document.getElementById("restaurants-count");
  }

  function bindEvents() {
    document.querySelectorAll(".tab-button").forEach(function (button) {
      button.addEventListener("click", function () {
        switchTab(button.getAttribute("data-tab"));
      });
    });

    refs.attractionSearch.addEventListener("input", renderAttractions);
    refs.attractionAreaFilter.addEventListener("change", renderAttractions);
    refs.attractionDisplayFilter.addEventListener("change", renderAttractions);
    refs.restaurantSearch.addEventListener("input", renderRestaurants);
    refs.restaurantAreaFilter.addEventListener("change", renderRestaurants);
    refs.restaurantCategoryFilter.addEventListener("change", renderRestaurants);

    document.getElementById("retry-location-button").addEventListener("click", function () {
      requestGpsLocation();
    });
    document.getElementById("ranking-retry-location-button").addEventListener("click", function () {
      requestGpsLocation();
    });
    document.getElementById("clear-ranking-button").addEventListener("click", clearRanking);
    document.getElementById("use-landmark-button").addEventListener("click", applyLandmarkFallback);
    document.getElementById("use-center-button").addEventListener("click", applyCenterFallback);

    refs.attractionsList.addEventListener("click", handleAttractionListClick);
    refs.attractionsList.addEventListener("input", handleWaitInput);
    refs.attractionsList.addEventListener("change", handleWaitInput);

    refs.rankingList.addEventListener("click", function (event) {
      const removeButton = event.target.closest("[data-remove-ranking]");
      if (!removeButton) {
        return;
      }
      removeFromRanking(removeButton.getAttribute("data-remove-ranking"));
    });
  }

  function renderAll() {
    renderLocation();
    renderAttractions();
    renderRanking();
    renderRestaurants();
  }

  function renderAttractions() {
    const searchValue = refs.attractionSearch.value.trim().toLowerCase();
    const areaValue = refs.attractionAreaFilter.value;
    const displayValue = refs.attractionDisplayFilter.value;

    const filtered = state.attractions.filter(function (item) {
      const textPool = [item.name, item.area, item.category, item.displayCategory || "", item.description, item.searchText || ""]
        .join(" ")
        .toLowerCase();
      if (searchValue && !textPool.includes(searchValue)) {
        return false;
      }
      if (areaValue && item.area !== areaValue) {
        return false;
      }
      if (displayValue && item.displayCategory !== displayValue) {
        return false;
      }
      return true;
    });

    refs.attractionsCount.textContent = filtered.length + "件";
    refs.attractionsList.innerHTML = filtered.map(renderAttractionCard).join("");
  }

  function renderAttractionCard(item) {
    const waitTime = getWaitTime(item.id);
    const alreadyAdded = state.selectedAttractions.includes(item.id);
    const unavailable = isAttractionUnavailable(item);
    const waitValue = waitTime === null ? "" : String(waitTime);
    const waitBadge = waitTime === null
      ? "<span class=\"badge neutral\">待ち時間: 未入力</span>"
      : "<span class=\"badge\">待ち時間: " + waitTime + "分</span>";

    return "" +
      "<article class=\"card attraction-card" + (unavailable ? " is-unavailable" : "") + "\">" +
        "<div class=\"attraction-visual\">" +
          (item.imageUrl ? "<img src=\"" + escapeHtml(item.imageUrl) + "\" alt=\"" + escapeHtml(item.name) + "\">" : "") +
        "</div>" +
        "<div class=\"card-body\">" +
          "<div class=\"card-topline\">" +
            "<p class=\"card-subtitle\">" + escapeHtml(item.area) + "</p>" +
            waitBadge +
          "</div>" +
          "<h3 class=\"card-title\">" + escapeHtml(item.name) + "</h3>" +
          "<div class=\"badge-row\">" +
            "<span class=\"badge\">" + escapeHtml(item.category) + "</span>" +
            (item.displayCategory ? "<span class=\"badge alt\">" + escapeHtml(item.displayCategory) + "</span>" : "") +
            (unavailable ? "<span class=\"badge unavailable\">休止中</span>" : "") +
          "</div>" +
          "<p class=\"card-description\">" + escapeHtml(item.description || "") + "</p>" +
          "<div class=\"wait-controls\" aria-label=\"" + escapeHtml(item.name) + " の待ち時間入力\">" +
            "<button class=\"wait-button\" type=\"button\" data-wait-action=\"decrease\" data-id=\"" + escapeHtml(item.id) + "\" " + (unavailable ? "disabled" : "") + ">-15</button>" +
            "<input class=\"wait-input\" inputmode=\"numeric\" pattern=\"[0-9]*\" placeholder=\"分\" aria-label=\"" + escapeHtml(item.name) + " の待ち時間\" data-wait-input=\"" + escapeHtml(item.id) + "\" value=\"" + escapeHtml(waitValue) + "\" " + (unavailable ? "disabled" : "") + ">" +
            "<button class=\"wait-button\" type=\"button\" data-wait-action=\"increase\" data-id=\"" + escapeHtml(item.id) + "\" " + (unavailable ? "disabled" : "") + ">+15</button>" +
          "</div>" +
          "<div class=\"card-footer\">" +
            "<div class=\"inline-actions\">" +
              "<button class=\"" + (alreadyAdded || unavailable ? "secondary-button" : "primary-button") + "\" type=\"button\" data-add-ranking=\"" + escapeHtml(item.id) + "\" " + (alreadyAdded || unavailable ? "disabled" : "") + ">" +
                (unavailable ? "休止中" : alreadyAdded ? "追加済み" : "ランキングに追加") +
              "</button>" +
            "</div>" +
            "<a class=\"detail-link\" href=\"" + escapeHtml(item.detailUrl) + "\" target=\"_blank\" rel=\"noreferrer\">公式詳細を見る</a>" +
          "</div>" +
        "</div>" +
      "</article>";
  }

  function renderRanking() {
    const selectedItems = state.selectedAttractions.map(function (id) {
      return attractionMap.get(id);
    }).filter(Boolean);

    refs.rankingSummary.innerHTML = buildRankingSummary(selectedItems);

    if (!selectedItems.length) {
      refs.rankingList.innerHTML = renderEmptyState(
        "まだランキング対象がありません。",
        "アトラクション一覧で「ランキングに追加」を押すと、ここで待ち時間と移動しやすさを見比べられます。"
      );
      return;
    }

    if (!hasTravelBasis()) {
      refs.rankingList.innerHTML = renderEmptyState(
        "位置情報がまだ確定していません。",
        "GPSの再取得を試すか、上のフォールバックで近い目印または中央を選ぶとランキング計算が始まります。"
      );
      return;
    }

    const scored = selectedItems.map(function (item) {
      const waitTime = getWaitTime(item.id);
      const travelInfo = getTravelInfo(item);
      const effectiveWait = waitTime === null ? UNKNOWN_WAIT_PENALTY : waitTime;
      const rawScore = 100 - (effectiveWait * WAIT_WEIGHT) - (travelInfo.minutes * TRAVEL_WEIGHT);
      const displayScore = Math.max(0, Math.round(rawScore));

      return {
        item: item,
        waitTime: waitTime,
        travelInfo: travelInfo,
        rawScore: rawScore,
        displayScore: displayScore
      };
    }).sort(function (a, b) {
      if (b.rawScore !== a.rawScore) {
        return b.rawScore - a.rawScore;
      }
      return a.item.name.localeCompare(b.item.name, "ja");
    });

    refs.rankingList.innerHTML = scored.map(function (entry, index) {
      const waitLabel = entry.waitTime === null ? "未入力" : entry.waitTime + "分";
      const travelLabel = entry.travelInfo.minutes + "分";
      const travelHint = entry.travelInfo.mode === "gps"
        ? "GPS概算 / " + escapeHtml(AREA_DISPLAY_NAMES[entry.travelInfo.areaCode] || "")
        : entry.travelInfo.mode === "fallback-center"
          ? "CENTER基準"
          : "目印エリア基準";

      return "" +
        "<article class=\"ranking-card\">" +
          "<div class=\"ranking-row\">" +
            "<div class=\"inline-actions\">" +
              "<div class=\"rank-number " + getRankClass(index) + "\">#" + (index + 1) + "</div>" +
              "<div>" +
                "<h3 class=\"card-title\">" + escapeHtml(entry.item.name) + "</h3>" +
                "<p class=\"card-subtitle\">" + escapeHtml(entry.item.area) + "</p>" +
              "</div>" +
            "</div>" +
            "<div class=\"badge-row\">" +
              "<span class=\"score-pill\">" + entry.displayScore + "</span>" +
              "<span class=\"badge alt\">" + escapeHtml(entry.item.displayCategory || entry.item.category) + "</span>" +
            "</div>" +
          "</div>" +
          "<div class=\"badge-row\">" +
            "<span class=\"badge\">待ち時間: " + waitLabel + "</span>" +
            "<span class=\"badge alt\">移動: " + travelLabel + "</span>" +
            (entry.travelInfo.mode === "fallback-center" ? "" : "<span class=\"badge neutral\">" + travelHint + "</span>") +
          "</div>" +
          "<div class=\"ranking-meta\">" +
            "<a class=\"detail-link\" href=\"" + escapeHtml(entry.item.detailUrl) + "\" target=\"_blank\" rel=\"noreferrer\">公式詳細を見る</a>" +
            "<button class=\"ghost-button\" type=\"button\" data-remove-ranking=\"" + escapeHtml(entry.item.id) + "\">外す</button>" +
          "</div>" +
        "</article>";
    }).join("");
  }

  function renderRestaurants() {
    const filtered = getFilteredRestaurants();
    const availableForRecommendation = filtered.filter(function (item) {
      return !isRestaurantUnavailable(item);
    });

    refs.restaurantsCount.textContent = filtered.length + "件";
    renderRestaurantRecommendation(availableForRecommendation, filtered.length);
    refs.restaurantsList.innerHTML = filtered.map(function (item) {
      const unavailable = isRestaurantUnavailable(item);
      return "" +
        "<article class=\"restaurant-card" + (unavailable ? " is-unavailable" : "") + "\">" +
          (item.imageUrl ? "<div class=\"restaurant-visual\"><img src=\"" + escapeHtml(item.imageUrl) + "\" alt=\"" + escapeHtml(item.name) + "\"></div>" : "") +
          "<div class=\"restaurant-body\">" +
            "<div class=\"card-topline\">" +
              "<p class=\"restaurant-meta\">" + escapeHtml(item.area) + "</p>" +
              "<div class=\"badge-row\">" +
                "<span class=\"badge\">" + escapeHtml(item.category) + "</span>" +
                (item.serviceType ? "<span class=\"badge alt\">" + escapeHtml(item.serviceType) + "</span>" : "") +
                (unavailable ? "<span class=\"badge unavailable\">休止中</span>" : "") +
              "</div>" +
            "</div>" +
            "<h3 class=\"restaurant-title\">" + escapeHtml(item.name) + "</h3>" +
            "<p class=\"restaurant-description\">" + escapeHtml(item.description || "") + "</p>" +
            "<div class=\"restaurant-footer\">" +
              "<a class=\"detail-link\" href=\"" + escapeHtml(item.detailUrl) + "\" target=\"_blank\" rel=\"noreferrer\">公式詳細を見る</a>" +
            "</div>" +
          "</div>" +
        "</article>";
    }).join("");
  }

  function renderLocation() {
    const pieces = [];
    renderLocationModeBanner();
    if (state.gps.status === "requesting") {
      pieces.push(renderLocationCard("GPS取得中", "現在地を確認しています。", "neutral"));
    } else if (state.gps.status === "success" && state.gps.position) {
      const nearestArea = getNearestAreaCode(state.gps.position);
      const detail = (AREA_DISPLAY_NAMES[nearestArea] || "不明エリア") + " 付近";
      pieces.push(renderLocationCard("GPSを使用中", detail, "ok"));
    } else if (state.gps.status === "error") {
      pieces.push(renderLocationCard("GPSを使えません", state.gps.errorMessage || "下から場所を選んでください。", "danger"));
    } else if (state.lastKnownPosition) {
      pieces.push(renderLocationCard("前回の位置あり", "再取得できます。", "neutral"));
    } else {
      pieces.push(renderLocationCard("位置未設定", "GPSを再取得してください。", "neutral"));
    }

    refs.locationStatus.innerHTML = pieces.join("");
    refs.fallbackPanel.classList.toggle("is-hidden", state.gps.status !== "error");
  }

  function renderLocationModeBanner() {
    if (state.gps.status === "success" && state.gps.position) {
      refs.locationModeBanner.className = "location-mode-banner is-hidden";
      refs.locationModeBanner.textContent = "";
      return;
    }

    if (!state.fallback) {
      refs.locationModeBanner.className = "location-mode-banner is-hidden";
      refs.locationModeBanner.textContent = "";
      return;
    }

    if (state.fallback.type === "landmark") {
      const attraction = attractionMap.get(state.fallback.attractionId);
      refs.locationModeBanner.className = "location-mode-banner landmark";
      refs.locationModeBanner.textContent = "現在の基準: 目印" + (attraction ? " / " + attraction.name : "");
      return;
    }

    refs.locationModeBanner.className = "location-mode-banner center";
    refs.locationModeBanner.textContent = "現在の基準: 位置がわからない";
  }

  function handleAttractionListClick(event) {
    const waitButton = event.target.closest("[data-wait-action]");
    if (waitButton) {
      adjustWaitTime(waitButton.getAttribute("data-id"), waitButton.getAttribute("data-wait-action"));
      return;
    }

    const addButton = event.target.closest("[data-add-ranking]");
    if (addButton) {
      addToRanking(addButton.getAttribute("data-add-ranking"));
    }
  }

  function handleWaitInput(event) {
    const input = event.target.closest("[data-wait-input]");
    if (!input) {
      return;
    }

    const id = input.getAttribute("data-wait-input");
    if (isAttractionUnavailable(attractionMap.get(id))) {
      return;
    }
    input.value = input.value.replace(/[^\d]/g, "");

    const cleaned = input.value.trim();
    if (!cleaned) {
      delete state.waitTimes[id];
      persistState();
      renderRanking();
      if (event.type === "change") {
        renderAttractions();
      }
      return;
    }

    const parsed = parseInt(cleaned, 10);
    if (Number.isNaN(parsed)) {
      return;
    }

    state.waitTimes[id] = { waitTime: Math.max(0, parsed) };
    persistState();
    renderRanking();
    if (event.type === "change") {
      renderAttractions();
    }
  }

  function adjustWaitTime(id, direction) {
    if (isAttractionUnavailable(attractionMap.get(id))) {
      return;
    }
    const current = getWaitTime(id);
    if (direction === "increase") {
      setWaitTime(id, (current === null ? 0 : current) + WAIT_STEP);
      return;
    }

    const nextValue = current === null ? 0 : Math.max(0, current - WAIT_STEP);
    setWaitTime(id, nextValue);
  }

  function setWaitTime(id, value) {
    state.waitTimes[id] = { waitTime: Math.max(0, Math.round(value)) };
    persistState();
    renderAttractions();
    renderRanking();
  }

  function getWaitTime(id) {
    const entry = state.waitTimes[id];
    return entry && Number.isInteger(entry.waitTime) ? entry.waitTime : null;
  }

  function addToRanking(id) {
    if (isAttractionUnavailable(attractionMap.get(id))) {
      return;
    }
    if (!state.selectedAttractions.includes(id)) {
      state.selectedAttractions.push(id);
      persistState();
      renderAttractions();
      renderRanking();
    }
  }

  function removeFromRanking(id) {
    state.selectedAttractions = state.selectedAttractions.filter(function (selectedId) {
      return selectedId !== id;
    });
    persistState();
    renderAttractions();
    renderRanking();
  }

  function clearRanking() {
    state.selectedAttractions = [];
    persistState();
    renderAttractions();
    renderRanking();
  }

  function requestGpsLocation() {
    if (!navigator.geolocation) {
      handleGpsFailure("この端末ではGPSが利用できません。");
      return;
    }

    state.gps.status = "requesting";
    state.gps.errorMessage = "";
    renderLocation();

    navigator.geolocation.getCurrentPosition(function (position) {
      state.gps.status = "success";
      state.gps.position = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy || null
      };
      state.lastKnownPosition = state.gps.position;
      saveJson(STORAGE_KEYS.lastKnownPosition, state.lastKnownPosition);
      renderLocation();
      renderRanking();
    }, function (error) {
      const messageMap = {
        1: "位置情報が拒否されました。",
        2: "位置情報を取得できません。",
        3: "GPSがタイムアウトしました。"
      };
      handleGpsFailure(messageMap[error.code] || "GPS取得に失敗しました。");
    }, {
      enableHighAccuracy: true,
      timeout: 8000,
      maximumAge: 60000
    });
  }

  function handleGpsFailure(message) {
    state.gps.status = "error";
    state.gps.position = null;
    state.gps.errorMessage = message;
    renderLocation();
    renderRanking();
  }

  function applyLandmarkFallback() {
    const attractionId = refs.fallbackLandmarkSelect.value;
    const attraction = attractionMap.get(attractionId);
    if (!attraction) {
      return;
    }

    state.fallback = {
      type: "landmark",
      attractionId: attraction.id,
      area: attraction.area
    };
    saveJson(STORAGE_KEYS.locationFallback, state.fallback);
    renderLocation();
    renderRanking();
  }

  function applyCenterFallback() {
    state.fallback = {
      type: "unknown-center",
      attractionId: null,
      area: null
    };
    saveJson(STORAGE_KEYS.locationFallback, state.fallback);
    renderLocation();
    renderRanking();
  }

  function getTravelInfo(attraction) {
    const areaCode = AREA_CODE_MAP[attraction.area];

    if (state.gps.status === "success" && state.gps.position) {
      const center = AREA_CENTERS[areaCode];
      const distanceMeters = haversineMeters(state.gps.position.lat, state.gps.position.lng, center.lat, center.lng);
      return {
        minutes: Math.max(2, Math.round(distanceMeters / 65)),
        mode: "gps",
        areaCode: areaCode
      };
    }

    if (!state.fallback) {
      return null;
    }

    if (state.fallback.type === "unknown-center") {
      return {
        minutes: AREA_TRAVEL_MINUTES.CENTER[areaCode],
        mode: "fallback-center",
        areaCode: areaCode
      };
    }

    const originAreaCode = AREA_CODE_MAP[state.fallback.area];
    return {
      minutes: AREA_TRAVEL_MINUTES[originAreaCode][areaCode],
      mode: "fallback-landmark",
      areaCode: areaCode
    };
  }

  function hasTravelBasis() {
    return (state.gps.status === "success" && state.gps.position) || Boolean(state.fallback);
  }

  function getNearestAreaCode(position) {
    let nearestCode = "MI";
    let nearestDistance = Number.POSITIVE_INFINITY;

    Object.keys(AREA_CENTERS).forEach(function (code) {
      const center = AREA_CENTERS[code];
      const distance = haversineMeters(position.lat, position.lng, center.lat, center.lng);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestCode = code;
      }
    });

    return nearestCode;
  }

  function buildRankingSummary(selectedItems) {
    const pills = [
      "<span class=\"summary-pill\">選択中 " + selectedItems.length + "件</span>"
    ];

    if (state.gps.status === "success" && state.gps.position) {
      pills.push("<span class=\"summary-pill\">GPS利用中</span>");
    } else if (state.fallback && state.fallback.type === "landmark") {
      const attraction = attractionMap.get(state.fallback.attractionId);
      pills.push("<span class=\"summary-pill\">目印基準: " + escapeHtml(attraction ? attraction.name : "選択済み") + "</span>");
    } else if (state.fallback && state.fallback.type === "unknown-center") {
      pills.push("<span class=\"summary-pill center-pill\">センター基準</span>");
    } else {
      pills.push("<span class=\"summary-pill alt\">位置未確定</span>");
    }

    return pills.join("");
  }

  function switchTab(tabName) {
    state.activeTab = tabName;
    document.querySelectorAll(".tab-button").forEach(function (button) {
      button.classList.toggle("is-active", button.getAttribute("data-tab") === tabName);
    });
    document.querySelectorAll("[data-panel]").forEach(function (panel) {
      panel.classList.toggle("is-hidden", panel.getAttribute("data-panel") !== tabName);
    });
  }

  function renderLocationCard(title, detail, tone) {
    return "" +
      "<div class=\"location-card\">" +
        "<div class=\"card-topline\">" +
          "<strong>" + escapeHtml(title) + "</strong>" +
          (tone === "danger" ? "" : "<span class=\"status-pill " + tone + "\">" + escapeHtml(toneLabel(tone)) + "</span>") +
        "</div>" +
        "<p class=\"location-detail\">" + escapeHtml(detail) + "</p>" +
      "</div>";
  }

  function renderEmptyState(title, body) {
    return "" +
      "<div class=\"empty-state\">" +
        "<strong>" + escapeHtml(title) + "</strong>" +
        "<p>" + escapeHtml(body) + "</p>" +
      "</div>";
  }

  function toneLabel(tone) {
    if (tone === "ok") {
      return "使用中";
    }
    if (tone === "danger") {
      return "";
    }
    return "情報";
  }

  function populateSelect(select, options) {
    select.innerHTML = options.map(function (option) {
      return "<option value=\"" + escapeHtml(option.value) + "\">" + escapeHtml(option.label) + "</option>";
    }).join("");
  }

  function persistState() {
    saveJson(STORAGE_KEYS.waitTimes, state.waitTimes);
    saveJson(STORAGE_KEYS.selectedAttractions, state.selectedAttractions);
  }

  function uniqueValues(values) {
    return Array.from(new Set(values));
  }

  function getFilteredRestaurants() {
    const searchValue = refs.restaurantSearch.value.trim().toLowerCase();
    const areaValue = refs.restaurantAreaFilter.value;
    const categoryValue = refs.restaurantCategoryFilter.value;

    return state.restaurants.filter(function (item) {
      const textPool = [item.name, item.area, item.category, item.serviceType || "", item.description || ""]
        .join(" ")
        .toLowerCase();
      if (searchValue && !textPool.includes(searchValue)) {
        return false;
      }
      if (areaValue && item.area !== areaValue) {
        return false;
      }
      if (categoryValue && item.category !== categoryValue) {
        return false;
      }
      return true;
    });
  }

  function renderRestaurantRecommendation(restaurants, totalFilteredCount) {
    if (!totalFilteredCount) {
      refs.restaurantRecommendation.innerHTML = renderEmptyState("候補なし", "条件に合うレストランがありません。");
      return;
    }

    if (!hasTravelBasis()) {
      refs.restaurantRecommendation.innerHTML = renderEmptyState("近いお店は未計算", "GPSまたは場所選択を使ってください。");
      return;
    }

    if (!restaurants.length) {
      refs.restaurantRecommendation.innerHTML = renderEmptyState("候補なし", "この条件では休止中の店舗のみです。");
      return;
    }

    const ranked = restaurants.map(function (item) {
      const travelInfo = getRestaurantTravelInfo(item);
      return {
        item: item,
        travelInfo: travelInfo
      };
    }).sort(function (a, b) {
      if (a.travelInfo.minutes !== b.travelInfo.minutes) {
        return a.travelInfo.minutes - b.travelInfo.minutes;
      }
      return a.item.name.localeCompare(b.item.name, "ja");
    }).slice(0, 3);

    refs.restaurantRecommendation.innerHTML =
      "<div class=\"recommendation-card\">" +
        "<div class=\"card-topline\">" +
          "<strong>近いレストラン</strong>" +
          "<span class=\"badge\">" + ranked.length + "件</span>" +
        "</div>" +
        "<div class=\"recommendation-list\">" +
          ranked.map(function (entry, index) {
            return "" +
              "<div class=\"recommendation-item\">" +
                "<div>" +
                  "<p class=\"restaurant-meta\">#" + (index + 1) + " / " + escapeHtml(entry.item.area) + "</p>" +
                  "<strong>" + escapeHtml(entry.item.name) + "</strong>" +
                "</div>" +
                "<span class=\"badge alt\">約" + entry.travelInfo.minutes + "分</span>" +
              "</div>";
          }).join("") +
        "</div>" +
      "</div>";
  }

  function getRestaurantTravelInfo(restaurant) {
    const areaCode = AREA_CODE_MAP[restaurant.area];

    if (state.gps.status === "success" && state.gps.position) {
      const center = AREA_CENTERS[areaCode];
      const distanceMeters = haversineMeters(state.gps.position.lat, state.gps.position.lng, center.lat, center.lng);
      return {
        minutes: Math.max(2, Math.round(distanceMeters / 65)),
        mode: "gps",
        areaCode: areaCode
      };
    }

    if (state.fallback.type === "unknown-center") {
      return {
        minutes: AREA_TRAVEL_MINUTES.CENTER[areaCode],
        mode: "fallback-center",
        areaCode: areaCode
      };
    }

    const originAreaCode = AREA_CODE_MAP[state.fallback.area];
    return {
      minutes: AREA_TRAVEL_MINUTES[originAreaCode][areaCode],
      mode: "fallback-landmark",
      areaCode: areaCode
    };
  }

  function isAttractionUnavailable(item) {
    return Boolean(item) && UNAVAILABLE_ATTRACTION_IDS.has(item.id);
  }

  function isRestaurantUnavailable(item) {
    return Boolean(item) && UNAVAILABLE_RESTAURANT_IDS.has(item.id);
  }

  function getRankClass(index) {
    if (index === 0) {
      return "rank-1";
    }
    if (index === 1) {
      return "rank-2";
    }
    if (index === 2) {
      return "rank-3";
    }
    return "rank-other";
  }

  function loadStoredObject(key, fallback) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function loadStoredArray(key) {
    const value = loadStoredObject(key, []);
    return Array.isArray(value) ? Array.from(new Set(value)) : [];
  }

  function saveJson(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      // Ignore storage quota issues in the static client.
    }
  }

  function haversineMeters(lat1, lng1, lat2, lng2) {
    const toRad = Math.PI / 180;
    const dLat = (lat2 - lat1) * toRad;
    const dLng = (lng2 - lng1) * toRad;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return 6371000 * c;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
})();
