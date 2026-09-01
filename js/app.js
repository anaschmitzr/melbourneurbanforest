var App = (function () {
    'use strict';

    // ==================== COLOR SCALES ====================

    var GRADE_COLORS = {
        '-10': '#67001f', '-9': '#7a0225', '-8': '#8c032b',
        '-7': '#980632', '-6': '#a50a2a',
        '-5': '#a50026', '-4': '#d73027', '-3': '#f46d43',
        '-2': '#fdae61', '-1': '#fee08b', '0': '#ffffbf',
        '1': '#d9ef8b', '2': '#a6d96a', '3': '#66bd63',
        '4': '#1a9850', '5': '#006837'
    };

    var ORIGIN_COLORS = { 'Native': '#27ae60', 'Introduced': '#f39c12', 'Exotic': '#c0392b' };
    var ENDEMIC_COLORS = { 'true': '#f1c40f', 'false': '#95a5a6' };
    var PASSFAIL_COLORS = { 'Pass': '#27ae60', 'Fail': '#c0392b', 'true': '#27ae60', 'false': '#c0392b' };

    var CAT_COLORS = [
        '#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4',
        '#42d4f4', '#f032e6', '#bfef45', '#fabed4', '#469990'
    ];

    var SEQ_GREEN = ['#f7fcf5', '#c7e9c0', '#74c476', '#238b45', '#00441b'];
    var SEQ_RED = ['#fee5d9', '#fcae91', '#fb6a4a', '#cb181d', '#67000d'];
    var SEQ_BLUE = ['#eff3ff', '#bdd7e7', '#6baed6', '#2171b5', '#08519c'];
    var SEQ_GOLD = ['#ffffd4', '#fed98e', '#fe9929', '#cc4c02', '#662506'];
    var DIST_SCALE = ['#006837', '#66bd63', '#d9ef8b', '#fee08b', '#fdae61', '#f46d43', '#d73027', '#a50026'];

    // ==================== UTILITIES ====================

    function gradeColor(g) {
        g = Math.round(Math.max(-10, Math.min(5, g)));
        return GRADE_COLORS[String(g)] || '#999';
    }

    function hexToRgb(hex) {
        hex = hex.replace('#', '');
        return {
            r: parseInt(hex.substring(0, 2), 16),
            g: parseInt(hex.substring(2, 4), 16),
            b: parseInt(hex.substring(4, 6), 16)
        };
    }

    function interpolate(val, min, max, scale) {
        val = Math.max(min, Math.min(max, val || 0));
        var t = (max === min) ? 0 : (val - min) / (max - min);
        var idx = t * (scale.length - 1);
        var lo = Math.floor(idx);
        var hi = Math.min(Math.ceil(idx), scale.length - 1);
        var f = idx - lo;
        var c1 = hexToRgb(scale[lo]), c2 = hexToRgb(scale[hi]);
        return 'rgb(' +
            Math.round(c1.r + f * (c2.r - c1.r)) + ',' +
            Math.round(c1.g + f * (c2.g - c1.g)) + ',' +
            Math.round(c1.b + f * (c2.b - c1.b)) + ')';
    }

    function topValues(data, prop, n) {
        var freq = {};
        data.features.forEach(function (f) {
            var v = f.properties[prop];
            if (v) freq[v] = (freq[v] || 0) + 1;
        });
        return Object.keys(freq)
            .sort(function (a, b) { return freq[b] - freq[a]; })
            .slice(0, n);
    }

    function catColor(value, list) {
        var i = list.indexOf(value);
        return i >= 0 ? CAT_COLORS[i] : '#888';
    }

    function num(v) { return v == null ? 0 : Number(v); }
    function fmt(v) { return v == null ? '–' : Number(v).toLocaleString(); }
    function pct(v) { return v == null ? '–' : Number(v).toFixed(1) + '%'; }

    // ==================== MAP ====================

    var map = L.map('map', {
        zoomControl: false, maxZoom: 20, minZoom: 10,
        preferCanvas: false
    }).fitBounds([[-37.863, 144.840], [-37.766, 145.053]]);

    L.control.zoom({ position: 'topright' }).addTo(map);
    new L.Hash(map);
    L.control.locate({ position: 'topright', locateOptions: { maxZoom: 19 } }).addTo(map);
    L.control.scale({ position: 'bottomleft', metric: true, imperial: false }).addTo(map);

    // Attribution / CC BY 4.0 license
    var LicenseControl = L.Control.extend({
        options: { position: 'bottomleft' },
        onAdd: function () {
            var div = L.DomUtil.create('div', 'leaflet-control license-control');
            div.innerHTML =
                '<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="license noopener">' +
                '<img src="https://licensebuttons.net/l/by/4.0/88x31.png" alt="CC BY 4.0 License">' +
                '</a>' +
                '<span>By <a href="https://anaschmitzr.github.io/portfolio/index.html" target="_blank" rel="noopener">Ana Schmitz</a> &mdash; <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="license noopener">CC BY 4.0</a></span>';
            L.DomEvent.disableClickPropagation(div);
            return div;
        }
    });
    new LicenseControl().addTo(map);

    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ',
        maxNativeZoom: 16, maxZoom: 20
    }).addTo(map);

    // Panes (z-order)
    ['municipal', 'parks', 'sa2', 'canopy', 'diversity', 'origin-sa2', 'park-sa2', 'buildings', 'trees', 'sa2-names'].forEach(function (name, i) {
        map.createPane('pane-' + name);
        map.getPane('pane-' + name).style.zIndex = 401 + i;
    });

    var canvasRenderer = L.canvas();

    // ==================== AREA FILTER ====================

    var currentFilter = '';
    var HIDDEN_STYLE = { fillOpacity: 0, opacity: 0, weight: 0 };
    var sa2Assigned = false;

    function pointInRing(pt, ring) {
        var x = pt[0], y = pt[1], inside = false;
        for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
            if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
        }
        return inside;
    }

    function pointInGeometry(pt, geom) {
        var polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
        for (var i = 0; i < polys.length; i++) {
            if (pointInRing(pt, polys[i][0])) return true;
        }
        return false;
    }

    function polygonCentroid(coords) {
        var ring = coords[0], sx = 0, sy = 0;
        for (var i = 0; i < ring.length; i++) { sx += ring[i][0]; sy += ring[i][1]; }
        return [sx / ring.length, sy / ring.length];
    }

    function precomputeSA2() {
        if (sa2Assigned) return;
        var sa2s = json_SA2_Melbourne_boundaries_2.features;
        var bounds = sa2s.map(function (f) {
            var coords = [], stack = [f.geometry.coordinates];
            while (stack.length) { var a = stack.pop(); if (typeof a[0] === 'number') coords.push(a); else for (var i = 0; i < a.length; i++) stack.push(a[i]); }
            var lngs = coords.map(function (c) { return c[0]; }), lats = coords.map(function (c) { return c[1]; });
            return { name: f.properties.sa2_name21, geom: f.geometry, minLng: Math.min.apply(null, lngs), maxLng: Math.max.apply(null, lngs), minLat: Math.min.apply(null, lats), maxLat: Math.max.apply(null, lats) };
        });

        function assignPoint(pt) {
            for (var i = 0; i < bounds.length; i++) {
                var b = bounds[i];
                if (pt[0] >= b.minLng && pt[0] <= b.maxLng && pt[1] >= b.minLat && pt[1] <= b.maxLat && pointInGeometry(pt, b.geom)) return b.name;
            }
            return null;
        }

        json_trees_species_dim_8.features.forEach(function (f) { f.properties._sa2 = assignPoint(f.geometry.coordinates); });
        json_building_nearest_parkbuilding_polygon_7.features.forEach(function (f) { f.properties._sa2 = assignPoint(polygonCentroid(f.geometry.coordinates)); });
        sa2Assigned = true;
        console.log('SA2 assignment complete');
    }

    // ==================== PRECOMPUTE ====================

    var topFamilies = topValues(json_trees_species_dim_8, 'family', 8);
    var topGenera = topValues(json_trees_species_dim_8, 'genus', 8);
    var topSpecies = topValues(json_trees_species_dim_8, 'common_name', 10);

    // Full lists for text matching in chat commands, longest first so that
    // e.g. "River Red Gum" wins over a shorter name contained within it.
    // Placeholders like "-" and "N/A" are dropped: they would match almost any sentence.
    function byLengthDesc(a, b) { return b.length - a.length; }
    function isRealName(v) { return /[a-z]{3}/i.test(v); }
    var allFamilies = topValues(json_trees_species_dim_8, 'family', 9999).filter(isRealName).sort(byLengthDesc);
    var allSpecies = topValues(json_trees_species_dim_8, 'common_name', 9999).filter(isRealName).sort(byLengthDesc);

    // ==================== POPUP BUILDERS ====================

    function badge(val) {
        var pass = (val === 'Pass' || val === 'true');
        var label = (val === 'true') ? 'Yes' : (val === 'false') ? 'No' : val;
        return '<span class="popup-badge ' + (pass ? 'pass' : 'fail') + '">' + label + '</span>';
    }
    function row(label, value) {
        return '<div class="popup-row"><span class="popup-label">' + label + '</span><span class="popup-value">' + value + '</span></div>';
    }

    function popupCanopy(p) {
        return '<div class="popup-content">' +
            '<div class="popup-title">' + p.sa2_name21 + '</div>' +
            '<div class="popup-divider"></div>' +
            row('Canopy', pct(p.canopy_percent)) +
            row('Grade', p.canopy_grade_5) +
            row('30% Target', badge(p.pass_fail_30)) +
            '</div>';
    }

    function popupDiversity(p) {
        return '<div class="popup-content">' +
            '<div class="popup-title">' + p.sa2_name21 + '</div>' +
            '<div class="popup-subtitle">' + fmt(p.total_trees) + ' trees</div>' +
            row('Species Grade', p.species_grade) +
            row('Genus Grade', p.genus_grade) +
            row('Family Grade', p.family_grade) +
            '<div class="popup-divider"></div>' +
            row('Max Species %', pct(p.max_species_pct)) +
            row('Max Genus %', pct(p.max_genus_pct)) +
            row('Max Family %', pct(p.max_family_pct)) +
            '</div>';
    }

    function popupOriginSA2(p) {
        return '<div class="popup-content">' +
            '<div class="popup-title">' + p.sa2_name21 + '</div>' +
            '<div class="popup-subtitle">' + fmt(p.total_trees) + ' trees</div>' +
            row('Native', pct(p.native_percent)) +
            row('Introduced', pct(p.introduced_percent)) +
            row('Exotic', pct(p.exotic_percent)) +
            row('Endemic Trees', fmt(p.endemic_count)) +
            '</div>';
    }

    function popupBuilding(p) {
        return '<div class="popup-content">' +
            '<div class="popup-title">Building Park Access</div>' +
            row('Nearest Park ID', p.nearest_park_id) +
            row('Distance', Math.round(num(p.routing_distance_m)) + ' m') +
            row('Grade', p.park_access_grade) +
            row('300m Target', badge(p.pass_fail_300)) +
            '</div>';
    }

    function popupTree(p) {
        var html = '<div class="popup-content">';
        html += '<div class="popup-title">' + (p.common_name || p.species_display || 'Unknown') + '</div>';
        if (p.scientific_name) html += '<div class="popup-subtitle">' + p.scientific_name + '</div>';
        if (p.age_description) html += row('Age', p.age_description);
        if (p.year_planted) html += row('Planted', p.year_planted);
        if (p.diameter_breast_height) html += row('DBH', p.diameter_breast_height);
        if (p.located_in) html += row('Located in', p.located_in);
        if (p.endemic === 'true') html += row('Endemic', 'Yes');
        html += '</div>';
        return html;
    }

    // ==================== STYLE FUNCTIONS ====================

    function styleCanopy(feature, mode) {
        var p = feature.properties, fill;
        if (mode === 'grade') fill = gradeColor(num(p.canopy_grade_5));
        else if (mode === 'passfail') fill = PASSFAIL_COLORS[p.pass_fail_30] || '#999';
        else fill = interpolate(num(p.canopy_percent), 0, 55, SEQ_GREEN);
        return { pane: 'pane-canopy', fillColor: fill, fillOpacity: 0.75, color: '#444', weight: 1.2, opacity: 0.7 };
    }

    function styleDiv(feature, mode) {
        var p = feature.properties, fill;
        if (mode === 'species_grade') fill = gradeColor(num(p.species_grade));
        else if (mode === 'genus_grade') fill = gradeColor(num(p.genus_grade));
        else if (mode === 'family_grade') fill = gradeColor(num(p.family_grade));
        else if (mode === 'species_passfail') fill = PASSFAIL_COLORS[p.species_pass] || '#999';
        else if (mode === 'genus_passfail') fill = PASSFAIL_COLORS[p.genus_pass] || '#999';
        else if (mode === 'family_passfail') fill = PASSFAIL_COLORS[p.family_pass] || '#999';
        else fill = '#999';
        return { pane: 'pane-diversity', fillColor: fill, fillOpacity: 0.75, color: '#444', weight: 1.2, opacity: 0.7 };
    }

    function styleOriginSA2(feature, mode) {
        var p = feature.properties, fill;
        if (mode === 'native_pct') fill = interpolate(num(p.native_percent), 0, 80, SEQ_GREEN);
        else if (mode === 'exotic_pct') fill = interpolate(num(p.exotic_percent), 0, 80, SEQ_RED);
        else if (mode === 'introduced_pct') fill = interpolate(num(p.introduced_percent), 0, 50, SEQ_BLUE);
        else fill = interpolate(num(p.endemic_count), 0, 50, SEQ_GOLD);
        return { pane: 'pane-origin-sa2', fillColor: fill, fillOpacity: 0.75, color: '#444', weight: 1.2, opacity: 0.7 };
    }

    function styleBuilding(feature, mode) {
        var p = feature.properties, fill;
        if (mode === 'grade') fill = gradeColor(num(p.park_access_grade));
        else if (mode === 'passfail') fill = PASSFAIL_COLORS[p.pass_fail_300] || '#999';
        else fill = interpolate(num(p.routing_distance_m), 0, 1000, DIST_SCALE);
        return { pane: 'pane-buildings', fillColor: fill, fillOpacity: 0.8, color: '#555', weight: 0.3, opacity: 0.4 };
    }

    function styleParkSA2(feature, mode) {
        var p = feature.properties, fill;
        if (mode === 'grade') fill = gradeColor(num(p.neighborhood_park_grade));
        else if (mode === 'passfail') fill = PASSFAIL_COLORS[p.pass_fail_300] || '#999';
        else fill = '#999';
        return { pane: 'pane-park-sa2', fillColor: fill, fillOpacity: 0.75, color: '#444', weight: 1.2, opacity: 0.7 };
    }

    function popupParkSA2(p) {
        return '<div class="popup-content">' +
            '<div class="popup-title">' + p.sa2_name21 + '</div>' +
            row('Avg Distance', Math.round(num(p.avg_distance_m)) + ' m') +
            row('Grade', p.neighborhood_park_grade) +
            row('300m Target', badge(p.pass_fail_300)) +
            '</div>';
    }

    function styleTree(feature, mode) {
        var p = feature.properties, fill;
        if (mode === 'origin') fill = ORIGIN_COLORS[p.origin] || '#888';
        else if (mode === 'endemic') fill = ENDEMIC_COLORS[p.endemic] || '#888';
        else if (mode === 'family') fill = catColor(p.family, topFamilies);
        else if (mode === 'genus') fill = catColor(p.genus, topGenera);
        else if (mode === 'species') fill = catColor(p.common_name, topSpecies);
        else fill = '#888';
        return {
            pane: 'pane-trees', radius: 4, fillColor: fill,
            fillOpacity: 0.85, color: '#333', weight: 0.5, opacity: 0.5
        };
    }

    // ==================== TOOLTIP LABEL ====================

    function labelValue(feature, layerName, mode) {
        var p = feature.properties;
        if (layerName === 'canopy') {
            if (mode === 'grade') return String(p.canopy_grade_5);
            if (mode === 'passfail') return p.pass_fail_30;
            return pct(p.canopy_percent);
        }
        if (layerName === 'diversity') {
            if (mode === 'species_grade') return String(p.species_grade);
            if (mode === 'genus_grade') return String(p.genus_grade);
            if (mode === 'family_grade') return String(p.family_grade);
            if (mode === 'species_passfail') return p.species_pass === 'true' ? 'Pass' : 'Fail';
            if (mode === 'genus_passfail') return p.genus_pass === 'true' ? 'Pass' : 'Fail';
            if (mode === 'family_passfail') return p.family_pass === 'true' ? 'Pass' : 'Fail';
        }
        if (layerName === 'origin-sa2') {
            if (mode === 'native_pct') return pct(p.native_percent);
            if (mode === 'exotic_pct') return pct(p.exotic_percent);
            if (mode === 'introduced_pct') return pct(p.introduced_percent);
            return String(p.endemic_count);
        }
        if (layerName === 'park-sa2') {
            if (mode === 'grade') return String(p.neighborhood_park_grade);
            if (mode === 'passfail') return p.pass_fail_300;
        }
        return '';
    }

    // ==================== CREATE LAYERS ====================

    function makeAnalysisLayer(data, paneName, styleFn, popupFn, layerName, defaultMode) {
        var layer = L.geoJson(data, {
            pane: paneName,
            style: function (f) { return styleFn(f, defaultMode); },
            onEachFeature: function (f, lyr) {
                lyr.bindPopup(popupFn(f.properties), { maxHeight: 350, maxWidth: 260 });
                lyr.bindTooltip(labelValue(f, layerName, defaultMode), {
                    permanent: true, direction: 'center', className: 'sa2-label'
                });
                lyr.on('mouseover', function (e) {
                    if (currentFilter && e.target.feature.properties.sa2_name21 !== currentFilter) return;
                    e.target.setStyle({ weight: 3, color: '#fff' }); e.target.bringToFront();
                });
                lyr.on('mouseout', function (e) {
                    var feat = e.target.feature;
                    if (currentFilter && feat.properties.sa2_name21 !== currentFilter) return;
                    var mode = document.getElementById('mode-' + layerName).value;
                    e.target.setStyle(styleFn(feat, mode));
                });
            }
        });
        return layer;
    }

    // Reference layers
    var layerMunicipal = L.geoJson(json_municipalboundary_1, {
        pane: 'pane-municipal',
        style: { color: '#333', weight: 3, fillOpacity: 0, opacity: 0.8, interactive: false },
        interactive: false
    }).addTo(map);

    var layerSA2 = L.geoJson(json_SA2_Melbourne_boundaries_2, {
        pane: 'pane-sa2',
        style: { color: '#666', weight: 1, fillOpacity: 0, opacity: 0.6, dashArray: '5,3' },
        interactive: false
    }).addTo(map);

    // Neighborhood name labels — one entry per SA2, manually adjustable
    // Each entry: [latitude, longitude] for the label position
    // File: js/app.js — search "SA2_LABEL_POSITIONS" to find this block
    // Position [lat, lng] and display label for each SA2 neighborhood
    // To break a label into 2 lines, add <br> in the 'label' field
    // File: js/app.js  —  search "SA2_LABELS" to find this block
    var SA2_LABELS = {
        'Melbourne CBD - North':          { pos: [-37.8075, 144.9560], label: 'Melbourne CBD<br>North' },
        'Melbourne CBD - East':           { pos: [-37.8145, 144.9650], label: 'Melbourne<br>CBD East' },
        'Melbourne CBD - West':           { pos: [-37.8185, 144.9560], label: 'Melbourne<br>CBD West' },
        'Carlton':                        { pos: [-37.7969, 144.9680], label: 'Carlton' },
        'Carlton North - Princes Hill':   { pos: [-37.7890, 144.9600], label: 'Carlton North<br>Princes Hill' },
        'Parkville':                      { pos: [-37.7830, 144.9480], label: 'Parkville' },
        'North Melbourne':                { pos: [-37.7935, 144.9400], label: 'North<br>Melbourne' },
        'West Melbourne - Residential':   { pos: [-37.8065, 144.9440], label: 'West Melbourne<br>Residential' },
        'West Melbourne - Industrial':    { pos: [-37.8119, 144.9180], label: 'West Melbourne<br>Industrial' },
        'Kensington (Vic.)':              { pos: [-37.7900, 144.9260], label: 'Kensington' },
        'Flemington Racecourse':          { pos: [-37.7890, 144.9090], label: 'Flemington<br>Racecourse' },
        'Docklands':                      { pos: [-37.8190, 144.9385], label: 'Docklands' },
        'East Melbourne':                 { pos: [-37.8120, 144.9745], label: 'East Melbourne' },
        'Southbank (West) - South Wharf': { pos: [-37.8250, 144.9530], label: 'Southbank West<br>South Wharf' },
        'Southbank - East':               { pos: [-37.8228, 144.9650], label: 'Southbank<br>East' },
        'South Yarra - West':             { pos: [-37.8350, 144.9770], label: 'South Yarra <br>West' },
        'Royal Botanic Gardens Victoria': { pos: [-37.8295, 144.9760], label: 'Royal<br>Botanic<br>Gardens' },
        'Port Melbourne Industrial':      { pos: [-37.8219, 144.9170], label: 'Port Melbourne<br>Industrial' }
    };

    var layerSA2Names = L.featureGroup({ pane: 'pane-sa2-names' });
    json_SA2_Melbourne_boundaries_2.features.forEach(function (f) {
        var name = f.properties.sa2_name21;
        var cfg = SA2_LABELS[name];
        if (!cfg) return;

        var marker = L.marker(cfg.pos, {
            pane: 'pane-sa2-names',
            icon: L.divIcon({
                className: 'sa2-name-label',
                html: '<span>' + cfg.label + '</span>',
                iconSize: [0, 0],
                iconAnchor: [0, 0]
            }),
            interactive: false
        });
        layerSA2Names.addLayer(marker);
    });

    var layerParks = L.geoJson(json_PPRZ_Parks_more_than_05h_3, {
        pane: 'pane-parks',
        style: { color: '#2d6a2d', weight: 0.5, fillColor: '#b2df8a', fillOpacity: 0.45 },
        interactive: false
    }).addTo(map);

    // Analysis layers
    var layerCanopy = makeAnalysisLayer(json_sa2_canopy_coverage_4, 'pane-canopy', styleCanopy, popupCanopy, 'canopy', 'grade');
    layerCanopy.addTo(map);

    var layerDiversity = makeAnalysisLayer(json_sa2_tree_diversity_5, 'pane-diversity', styleDiv, popupDiversity, 'diversity', 'species_grade');

    var layerOriginSA2 = makeAnalysisLayer(json_sa2_tree_origin_6, 'pane-origin-sa2', styleOriginSA2, popupOriginSA2, 'origin-sa2', 'native_pct');

    var layerParkSA2 = makeAnalysisLayer(json_sa2_park_access_1, 'pane-park-sa2', styleParkSA2, popupParkSA2, 'park-sa2', 'grade');

    var layerBuildings = L.geoJson(json_building_nearest_parkbuilding_polygon_7, {
        pane: 'pane-buildings',
        renderer: canvasRenderer,
        style: function (f) { return styleBuilding(f, 'grade'); },
        onEachFeature: function (f, lyr) {
            lyr.bindPopup(popupBuilding(f.properties), { maxHeight: 300, maxWidth: 240 });
        }
    });

    // Trees
    var treeMode = 'origin';
    var layerTrees = L.geoJson(json_trees_species_dim_8, {
        pane: 'pane-trees',
        pointToLayer: function (f, latlng) {
            return L.circleMarker(latlng, styleTree(f, treeMode));
        },
        onEachFeature: function (f, lyr) {
            lyr.bindPopup(popupTree(f.properties), { maxHeight: 350, maxWidth: 260 });
            lyr.on('click', function () { showTreeInfo(f.properties); });
        }
    });
    var plainTreeGroup = L.featureGroup();
    layerTrees.eachLayer(function (m) { plainTreeGroup.addLayer(m); });
    // Trees start OFF to keep initial load light
    var activeTreeGroup = plainTreeGroup;

    var allTreeMarkers = [];
    layerTrees.eachLayer(function (m) { allTreeMarkers.push(m); });

    function createBuildingsLayer(data) {
        return L.geoJson(data, {
            pane: 'pane-buildings',
            renderer: canvasRenderer,
            style: function (f) { return styleBuilding(f, document.getElementById('mode-buildings').value); },
            onEachFeature: function (f, lyr) {
                lyr.bindPopup(popupBuilding(f.properties), { maxHeight: 300, maxWidth: 240 });
            }
        });
    }

    // Layer registry
    var layers = {
        'canopy': layerCanopy,
        'diversity': layerDiversity,
        'origin-sa2': layerOriginSA2,
        'park-sa2': layerParkSA2,
        'buildings': layerBuildings,
        'trees': activeTreeGroup,
        'parks': layerParks,
        'sa2': layerSA2,
        'sa2-names': layerSA2Names,
        'municipal': layerMunicipal
    };

    var styleFns = {
        'canopy': styleCanopy,
        'diversity': styleDiv,
        'origin-sa2': styleOriginSA2,
        'park-sa2': styleParkSA2,
        'buildings': styleBuilding
    };

    var geoJsonLayers = {
        'canopy': layerCanopy,
        'diversity': layerDiversity,
        'origin-sa2': layerOriginSA2,
        'park-sa2': layerParkSA2,
        'buildings': layerBuildings
    };

    // ==================== LEGEND RENDERING ====================

    // Grade descriptions for canopy
    var CANOPY_GRADE_DESC = {
        '5': '54–60%', '4': '48–54%', '3': '42–48%', '2': '36–42%', '1': '30–36%',
        '0': '30%', '-1': '24–30%', '-2': '18–24%', '-3': '12–18%', '-4': '6–12%', '-5': '0–6%'
    };

    // Grade descriptions for park access
    var ACCESS_GRADE_DESC = {
        '5': '0–60m', '4': '60–120m', '3': '120–180m', '2': '180–240m', '1': '240–300m',
        '0': '300m', '-1': '300–360m', '-2': '360–420m', '-3': '420–480m', '-4': '480–540m', '-5': '540m+'
    };

    var SPECIES_GRADE_DESC = {
        '3': '1–4%', '2': '4–7%', '1': '7–10%',
        '0': '10%', '-1': '10–13%', '-2': '13–16%', '-3': '16–19%', '-4': '19–22%',
        '-5': '22–25%', '-6': '25–28%', '-7': '28–31%', '-8': '31–34%', '-9': '34–37%', '-10': '37%+'
    };

    var GENUS_GRADE_DESC = {
        '3': '5–10%', '2': '10–15%', '1': '15–20%',
        '0': '20%', '-1': '20–25%', '-2': '25–30%', '-3': '30–35%', '-4': '35–40%',
        '-5': '40–45%', '-6': '45–50%', '-7': '50–55%', '-8': '55–60%', '-9': '60–65%', '-10': '65%+'
    };

    var FAMILY_GRADE_DESC = {
        '3': '15–20%', '2': '20–25%', '1': '25–30%',
        '0': '30%', '-1': '30–35%', '-2': '35–40%', '-3': '40–45%', '-4': '45–50%',
        '-5': '50–55%', '-6': '55–60%', '-7': '60–65%', '-8': '65–70%', '-9': '70–75%', '-10': '75%+'
    };

    function renderGradeLegend(el, descriptions, twoCols) {
        var desc = descriptions || {};
        // Derive grade range from description keys if provided, else default -5..+5
        var keys = Object.keys(desc).map(Number);
        var maxG = keys.length ? Math.max.apply(null, keys) : 5;
        var minG = keys.length ? Math.min.apply(null, keys) : -5;
        var grades = [];
        for (var g = maxG; g >= minG; g--) grades.push(g);

        function renderRow(g) {
            var label = (g > 0 ? '+' : '') + g;
            var detail = desc[String(g)] || '';
            var color = GRADE_COLORS[String(g)] || '#999';
            var h = '<div class="legend-row"><span class="legend-swatch" style="background:' + color + '"></span><span class="legend-label">' + label + '</span>';
            if (detail) h += '<span class="legend-detail">' + detail + '</span>';
            h += '</div>';
            return h;
        }

        if (twoCols) {
            // Split: positives+zero in left col, negatives in right col
            var col1 = [], col2 = [];
            grades.forEach(function (g) { (g >= 0 ? col1 : col2).push(g); });
            var html = '<div class="legend-two-col">';
            html += '<div class="legend-vertical">';
            col1.forEach(function (g) { html += renderRow(g); });
            html += '</div><div class="legend-vertical">';
            col2.forEach(function (g) { html += renderRow(g); });
            html += '</div></div>';
            el.innerHTML = html;
        } else {
            var html = '<div class="legend-vertical">';
            grades.forEach(function (g) { html += renderRow(g); });
            html += '</div>';
            el.innerHTML = html;
        }
    }

    function renderPassFailLegend(el, labels, details) {
        var passLabel = labels ? labels[0] : 'Pass';
        var failLabel = labels ? labels[1] : 'Fail';
        var passDetail = details ? details[0] : '';
        var failDetail = details ? details[1] : '';
        el.innerHTML =
            '<div class="legend-vertical">' +
            '<div class="legend-row"><span class="legend-swatch" style="background:#27ae60"></span><span class="legend-label">' + passLabel + '</span><span class="legend-detail">' + passDetail + '</span></div>' +
            '<div class="legend-row"><span class="legend-swatch" style="background:#c0392b"></span><span class="legend-label">' + failLabel + '</span><span class="legend-detail">' + failDetail + '</span></div>' +
            '</div>';
    }

    function renderGradientLegend(el, minLabel, maxLabel, colors) {
        el.innerHTML =
            '<div class="legend-gradient">' +
            '<div class="legend-gradient-bar" style="background:linear-gradient(to right,' + colors.join(',') + ')"></div>' +
            '<div class="legend-gradient-labels"><span>' + minLabel + '</span><span>' + maxLabel + '</span></div>' +
            '</div>';
    }

    function renderCatLegend(el, items, colorFn, twoCols) {
        var all = items.slice();
        all.push('Other');
        if (twoCols) {
            var mid = Math.ceil(all.length / 2);
            var col1 = all.slice(0, mid);
            var col2 = all.slice(mid);
            var html = '<div class="legend-two-col">';
            html += '<div class="legend-vertical">';
            col1.forEach(function (item) {
                var c = item === 'Other' ? '#888' : colorFn(item);
                html += '<div class="legend-row"><span class="legend-swatch" style="background:' + c + '"></span><span class="legend-label">' + item + '</span></div>';
            });
            html += '</div><div class="legend-vertical">';
            col2.forEach(function (item) {
                var c = item === 'Other' ? '#888' : colorFn(item);
                html += '<div class="legend-row"><span class="legend-swatch" style="background:' + c + '"></span><span class="legend-label">' + item + '</span></div>';
            });
            html += '</div></div>';
            el.innerHTML = html;
        } else {
            var html = '<div class="legend-vertical">';
            all.forEach(function (item) {
                var c = item === 'Other' ? '#888' : colorFn(item);
                html += '<div class="legend-row"><span class="legend-swatch" style="background:' + c + '"></span><span class="legend-label">' + item + '</span></div>';
            });
            html += '</div>';
            el.innerHTML = html;
        }
    }

    function updateLegend(layerName, mode) {
        var el = document.getElementById('legend-' + layerName);
        if (!el) return;

        if (layerName === 'canopy') {
            if (mode === 'grade') renderGradeLegend(el, CANOPY_GRADE_DESC, true);
            else if (mode === 'passfail') renderPassFailLegend(el, ['Pass', 'Fail'], ['≥ 30% canopy', '< 30% canopy']);
            else renderGradientLegend(el, '0%', '55%', SEQ_GREEN);
        }
        else if (layerName === 'diversity') {
            if (mode === 'species_grade') renderGradeLegend(el, SPECIES_GRADE_DESC, true);
            else if (mode === 'genus_grade') renderGradeLegend(el, GENUS_GRADE_DESC, true);
            else if (mode === 'family_grade') renderGradeLegend(el, FAMILY_GRADE_DESC, true);
            else if (mode === 'species_passfail') renderPassFailLegend(el, ['Pass', 'Fail'], ['Max species ≤ 10%', 'Max species > 10%']);
            else if (mode === 'genus_passfail') renderPassFailLegend(el, ['Pass', 'Fail'], ['Max genus ≤ 20%', 'Max genus > 20%']);
            else if (mode === 'family_passfail') renderPassFailLegend(el, ['Pass', 'Fail'], ['Max family ≤ 30%', 'Max family > 30%']);
            else renderPassFailLegend(el);
        }
        else if (layerName === 'origin-sa2') {
            if (mode === 'native_pct') renderGradientLegend(el, '0%', '80%', SEQ_GREEN);
            else if (mode === 'exotic_pct') renderGradientLegend(el, '0%', '80%', SEQ_RED);
            else if (mode === 'introduced_pct') renderGradientLegend(el, '0%', '50%', SEQ_BLUE);
            else renderGradientLegend(el, '0', '50', SEQ_GOLD);
        }
        else if (layerName === 'park-sa2') {
            if (mode === 'grade') renderGradeLegend(el, ACCESS_GRADE_DESC, true);
            else if (mode === 'passfail') renderPassFailLegend(el, ['Pass', 'Fail'], ['≤ 300m to park', '> 300m to park']);
        }
        else if (layerName === 'buildings') {
            if (mode === 'grade') renderGradeLegend(el, ACCESS_GRADE_DESC, true);
            else if (mode === 'passfail') renderPassFailLegend(el, ['Pass', 'Fail'], ['≤ 300m to park', '> 300m to park']);
            else renderGradientLegend(el, '0 m', '1000 m', DIST_SCALE);
        }
        else if (layerName === 'trees') {
            if (mode === 'origin') {
                el.innerHTML =
                    '<div class="legend-two-col">' +
                    '<div class="legend-vertical">' +
                    '<div class="legend-row"><span class="legend-swatch" style="background:#27ae60"></span><span class="legend-label">Native</span></div>' +
                    '<div class="legend-row"><span class="legend-swatch" style="background:#f39c12"></span><span class="legend-label">Introduced</span></div>' +
                    '</div><div class="legend-vertical">' +
                    '<div class="legend-row"><span class="legend-swatch" style="background:#c0392b"></span><span class="legend-label">Exotic</span></div>' +
                    '</div></div>';
            }
            else if (mode === 'endemic') {
                el.innerHTML =
                    '<div class="legend-two-col">' +
                    '<div class="legend-vertical">' +
                    '<div class="legend-row"><span class="legend-swatch" style="background:#f1c40f"></span><span class="legend-label">Endemic</span></div>' +
                    '</div><div class="legend-vertical">' +
                    '<div class="legend-row"><span class="legend-swatch" style="background:#95a5a6"></span><span class="legend-label">Not Endemic</span></div>' +
                    '</div></div>';
            }
            else if (mode === 'family') renderCatLegend(el, topFamilies, function (v) { return catColor(v, topFamilies); }, true);
            else if (mode === 'genus') renderCatLegend(el, topGenera, function (v) { return catColor(v, topGenera); }, true);
            else if (mode === 'species') renderCatLegend(el, topSpecies, function (v) { return catColor(v, topSpecies); }, true);
        }
    }

    // ==================== STYLE UPDATE ====================

    function updateStyle(layerName, mode) {
        if (layerName === 'trees') {
            treeMode = mode;
            allTreeMarkers.forEach(function (marker) {
                marker.setStyle(styleTree(marker.feature, mode));
            });
        } else if (layerName === 'buildings') {
            var wasOn = map.hasLayer(layers.buildings);
            if (wasOn) map.removeLayer(layers.buildings);
            layerBuildings = createBuildingsLayer(filterSpatialData(json_building_nearest_parkbuilding_polygon_7));
            layers.buildings = layerBuildings;
            geoJsonLayers.buildings = layerBuildings;
            if (wasOn) layerBuildings.addTo(map);
        } else if (geoJsonLayers[layerName]) {
            var fn = styleFns[layerName];
            var gj = geoJsonLayers[layerName];
            gj.eachLayer(function (lyr) {
                if (currentFilter && lyr.feature.properties.sa2_name21 !== currentFilter) return;
                lyr.setStyle(fn(lyr.feature, mode));
                if (lyr.getTooltip) {
                    var tt = lyr.getTooltip();
                    if (tt) lyr.setTooltipContent(labelValue(lyr.feature, layerName, mode));
                }
            });
        }
        updateLegend(layerName, mode);
    }

    function filterSpatialData(data) {
        if (!currentFilter) return data;
        return { type: 'FeatureCollection', features: data.features.filter(function (f) { return f.properties._sa2 === currentFilter; }) };
    }

    // ==================== LAYER TOGGLE ====================

    function toggleLayer(name, on) {
        var lyr = layers[name];
        if (!lyr) return;
        if (on) {
            if (!map.hasLayer(lyr)) map.addLayer(lyr);
        } else {
            if (map.hasLayer(lyr)) map.removeLayer(lyr);
        }
        var panel = document.getElementById('panel-' + name);
        if (panel) panel.classList.toggle('off', !on);
    }

    // ==================== SIDEBAR ====================

    function toggleSidebar() {
        document.getElementById('sidebar').classList.toggle('collapsed');
        setTimeout(function () { map.invalidateSize(); }, 350);
    }

    function togglePanel(panelId) {
        var panel = document.getElementById(panelId);
        if (panel) panel.classList.toggle('collapsed');
    }

    // ==================== AREA FILTER LOGIC ====================

    function applyAreaFilter() {
        // SA2 polygon layers: show/hide by name
        ['canopy', 'diversity', 'origin-sa2'].forEach(function (name) {
            var gj = geoJsonLayers[name];
            if (!gj) return;
            var mode = document.getElementById('mode-' + name).value;
            var fn = styleFns[name];
            gj.eachLayer(function (lyr) {
                if (!currentFilter || lyr.feature.properties.sa2_name21 === currentFilter) {
                    lyr.setStyle(fn(lyr.feature, mode));
                    if (lyr.getTooltip()) lyr.openTooltip();
                } else {
                    lyr.setStyle(HIDDEN_STYLE);
                    if (lyr.getTooltip()) lyr.closeTooltip();
                }
            });
        });

        // Buildings: re-apply building filter (respects area + UI filters)
        applyBuildingFilter();

        // Trees: re-apply UI tree filter (respects area + UI filters)
        applyUITreeFilter();
    }

    function setAreaFilter(sa2Name) {
        currentFilter = sa2Name || '';

        if (!sa2Name) {
            map.fitBounds([[-37.863, 144.840], [-37.766, 145.053]]);
        } else {
            var target = json_SA2_Melbourne_boundaries_2.features.find(function (f) { return f.properties.sa2_name21 === sa2Name; });
            if (target) map.fitBounds(L.geoJson(target).getBounds(), { padding: [30, 30] });
        }

        if (!sa2Assigned && sa2Name) {
            var btn = document.getElementById('area-filter');
            if (btn) btn.style.opacity = '0.5';
            precomputeSA2();
            if (btn) btn.style.opacity = '1';
        }

        applyAreaFilter();
    }

    // ==================== QUERY ENGINE ====================

    var trees = json_trees_species_dim_8.features;
    var sa2Canopy = json_sa2_canopy_coverage_4.features;
    var sa2Diversity = json_sa2_tree_diversity_5.features;
    var sa2Origin = json_sa2_tree_origin_6.features;
    var buildings = json_building_nearest_parkbuilding_polygon_7.features;

    var sa2Names = sa2Canopy.map(function (f) { return f.properties.sa2_name21; });
    // Longest first, so "Carlton North - Princes Hill" is not shadowed by "Carlton"
    var sa2NamesByLength = sa2Names.slice().sort(function (a, b) { return b.length - a.length; });
    var precincts = topValues(json_trees_species_dim_8, 'precinct', 100);
    var ageValues = topValues(json_trees_species_dim_8, 'age_description', 20);
    var originValues = ['Native', 'Introduced', 'Exotic'];

    function matchList(q, list) {
        q = q.toLowerCase();
        for (var i = 0; i < list.length; i++) {
            if (list[i] && q.indexOf(list[i].toLowerCase()) >= 0) return list[i];
        }
        return null;
    }

    function filterTrees(q) {
        var result = trees;
        var loc = matchList(q, sa2Names) || matchList(q, precincts);
        if (loc) {
            result = result.filter(function (f) {
                return (f.properties.precinct === loc || f.properties.sa2_name21 === loc);
            });
        }
        var origin = matchList(q, originValues);
        if (origin) result = result.filter(function (f) { return f.properties.origin === origin; });
        var age = matchList(q, ageValues);
        if (age) result = result.filter(function (f) { return f.properties.age_description === age; });
        if (/\bendemic\b/i.test(q)) result = result.filter(function (f) { return f.properties.endemic === 'true'; });

        var familyMatch = null;
        topFamilies.forEach(function (fam) { if (q.toLowerCase().indexOf(fam.toLowerCase()) >= 0) familyMatch = fam; });
        if (familyMatch) result = result.filter(function (f) { return f.properties.family === familyMatch; });

        var speciesMatch = null;
        topSpecies.forEach(function (sp) { if (q.toLowerCase().indexOf(sp.toLowerCase()) >= 0) speciesMatch = sp; });
        if (speciesMatch) result = result.filter(function (f) { return f.properties.common_name === speciesMatch; });

        return { trees: result, location: loc, origin: origin, age: age, family: familyMatch, species: speciesMatch };
    }

    function freqCount(arr, prop) {
        var freq = {};
        arr.forEach(function (f) {
            var v = f.properties[prop];
            if (v) freq[v] = (freq[v] || 0) + 1;
        });
        return Object.keys(freq)
            .map(function (k) { return { name: k, count: freq[k] }; })
            .sort(function (a, b) { return b.count - a.count; });
    }

    function describeFilter(f) {
        var parts = [];
        if (f.origin) parts.push(f.origin.toLowerCase());
        if (f.age) parts.push(f.age.toLowerCase());
        if (f.family) parts.push(f.family);
        if (f.species) parts.push(f.species);
        if (parts.length) return parts.join(' ') + ' trees';
        return 'trees';
    }

    function smartAnswer(question) {
        var q = question.toLowerCase().trim();

        // SA2-level queries
        if (/which.*(highest|most|best|greatest|top).*canopy/i.test(q) || /highest canopy/i.test(q)) {
            var sorted = sa2Canopy.slice().sort(function (a, b) { return num(b.properties.canopy_percent) - num(a.properties.canopy_percent); });
            var top = sorted[0].properties;
            return '<strong>' + top.sa2_name21 + '</strong> has the highest canopy coverage at <span class="chat-number">' + pct(top.canopy_percent) + '</span> (grade ' + top.canopy_grade_5 + ').';
        }
        if (/which.*(lowest|least|worst|fewest).*canopy/i.test(q) || /lowest canopy/i.test(q)) {
            var sorted = sa2Canopy.slice().sort(function (a, b) { return num(a.properties.canopy_percent) - num(b.properties.canopy_percent); });
            var bot = sorted[0].properties;
            return '<strong>' + bot.sa2_name21 + '</strong> has the lowest canopy coverage at <span class="chat-number">' + pct(bot.canopy_percent) + '</span> (grade ' + bot.canopy_grade_5 + ').';
        }
        if (/which.*(highest|most|best).*diversity/i.test(q) || /most diverse/i.test(q)) {
            var sorted = sa2Diversity.slice().sort(function (a, b) { return num(b.properties.species_grade) - num(a.properties.species_grade); });
            var top = sorted[0].properties;
            return '<strong>' + top.sa2_name21 + '</strong> has the highest species diversity grade of <span class="chat-number">' + top.species_grade + '</span> (max species ' + pct(top.max_species_pct) + ').';
        }
        if (/which.*(highest|most).*native/i.test(q)) {
            var sorted = sa2Origin.slice().sort(function (a, b) { return num(b.properties.native_percent) - num(a.properties.native_percent); });
            var top = sorted[0].properties;
            return '<strong>' + top.sa2_name21 + '</strong> has the highest native tree proportion at <span class="chat-number">' + pct(top.native_percent) + '</span>.';
        }
        if (/which.*(highest|most).*exotic/i.test(q)) {
            var sorted = sa2Origin.slice().sort(function (a, b) { return num(b.properties.exotic_percent) - num(a.properties.exotic_percent); });
            var top = sorted[0].properties;
            return '<strong>' + top.sa2_name21 + '</strong> has the highest exotic tree proportion at <span class="chat-number">' + pct(top.exotic_percent) + '</span>.';
        }

        // Canopy lookup for specific SA2
        var canopyLookup = matchList(q, sa2Names);
        if (canopyLookup && /canopy|coverage|cover/i.test(q)) {
            var sa2 = sa2Canopy.find(function (f) { return f.properties.sa2_name21 === canopyLookup; });
            if (sa2) {
                var p = sa2.properties;
                return '<strong>' + p.sa2_name21 + '</strong> has <span class="chat-number">' + pct(p.canopy_percent) + '</span> canopy coverage (grade ' + p.canopy_grade_5 + ', ' + p.pass_fail_30 + ' 30% target).';
            }
        }

        // Diversity lookup for specific SA2
        if (canopyLookup && /diversity|diverse/i.test(q)) {
            var sa2 = sa2Diversity.find(function (f) { return f.properties.sa2_name21 === canopyLookup; });
            if (sa2) {
                var p = sa2.properties;
                return '<strong>' + p.sa2_name21 + '</strong>: species grade <span class="chat-number">' + p.species_grade + '</span>, genus grade <span class="chat-number">' + p.genus_grade + '</span>, family grade <span class="chat-number">' + p.family_grade + '</span>.';
            }
        }

        // Park access
        if (/how many.*(building|house|home).*(fail|no access|far)/i.test(q) || /building.*fail.*park/i.test(q)) {
            var fails = buildings.filter(function (f) { return f.properties.pass_fail_300 === 'Fail'; });
            return '<span class="chat-number">' + fails.length.toLocaleString() + '</span> out of ' + buildings.length.toLocaleString() + ' buildings (' + (fails.length / buildings.length * 100).toFixed(1) + '%) fail the 300m park access target.';
        }
        if (/average.*distance.*park/i.test(q)) {
            var total = 0;
            buildings.forEach(function (f) { total += num(f.properties.routing_distance_m); });
            var avg = total / buildings.length;
            return 'The average walking distance to the nearest park is <span class="chat-number">' + Math.round(avg) + ' m</span> across all ' + buildings.length.toLocaleString() + ' buildings.';
        }

        // Tree queries
        var f = filterTrees(q);

        // "Most common species/family/genus"
        if (/most common|most popular|most frequent|dominant/i.test(q)) {
            var prop = 'common_name';
            if (/family|families/i.test(q)) prop = 'family';
            else if (/genus|genera/i.test(q)) prop = 'genus';
            var ranked = freqCount(f.trees, prop);
            if (ranked.length === 0) return 'No matching trees found.';
            var top5 = ranked.slice(0, 5);
            var label = prop === 'common_name' ? 'species' : prop;
            var where = f.location ? ' in <strong>' + f.location + '</strong>' : '';
            var html = 'Top ' + label + where + ':<br>';
            top5.forEach(function (item, i) {
                html += (i + 1) + '. <span class="chat-highlight">' + item.name + '</span> — <span class="chat-number">' + item.count.toLocaleString() + '</span> trees<br>';
            });
            return html;
        }

        // "How many" / count
        if (/how many|count|number of|total/i.test(q)) {
            var desc = describeFilter(f);
            var where = f.location ? ' in <strong>' + f.location + '</strong>' : '';
            return 'There are <span class="chat-number">' + f.trees.length.toLocaleString() + '</span> ' + desc + where + '.';
        }

        // "Percentage" / "what percent"
        if (/percent|proportion|ratio|share/i.test(q)) {
            var desc = describeFilter(f);
            var base = f.location ? filterTrees(f.location).trees.length : trees.length;
            var perc = base > 0 ? (f.trees.length / base * 100).toFixed(1) : '0';
            var where = f.location ? ' in <strong>' + f.location + '</strong>' : '';
            return '<span class="chat-number">' + perc + '%</span> of trees' + where + ' are ' + desc + ' (' + f.trees.length.toLocaleString() + ' of ' + base.toLocaleString() + ').';
        }

        // Generic location query
        if (f.location && f.trees.length > 0) {
            var origin_freq = freqCount(f.trees, 'origin');
            var topSp = freqCount(f.trees, 'common_name').slice(0, 3);
            var html = '<strong>' + f.location + '</strong> has <span class="chat-number">' + f.trees.length.toLocaleString() + '</span> trees.<br>';
            html += 'Origin mix: ';
            origin_freq.forEach(function (o, i) {
                html += o.name + ' ' + (o.count / f.trees.length * 100).toFixed(0) + '%';
                if (i < origin_freq.length - 1) html += ', ';
            });
            html += '.<br>Top species: ';
            topSp.forEach(function (s, i) {
                html += '<span class="chat-highlight">' + s.name + '</span> (' + s.count + ')';
                if (i < topSp.length - 1) html += ', ';
            });
            return html;
        }

        // Summary / overview
        if (/summary|overview|tell me about|total trees/i.test(q)) {
            var nativeCount = trees.filter(function (f) { return f.properties.origin === 'Native'; }).length;
            var exoticCount = trees.filter(function (f) { return f.properties.origin === 'Exotic'; }).length;
            var canopyPass = sa2Canopy.filter(function (f) { return f.properties.pass_fail_30 === 'Pass'; }).length;
            return 'Melbourne has <span class="chat-number">' + trees.length.toLocaleString() + '</span> trees across ' + sa2Names.length + ' neighborhoods.<br>' +
                'Native: <span class="chat-number">' + (nativeCount / trees.length * 100).toFixed(1) + '%</span>, Exotic: <span class="chat-number">' + (exoticCount / trees.length * 100).toFixed(1) + '%</span>.<br>' +
                'Canopy: <span class="chat-number">' + canopyPass + '/' + sa2Canopy.length + '</span> SA2s pass the 30% target.';
        }

        // Fallback
        return "I can answer questions about tree counts, species, origins, canopy coverage, diversity grades, and park access. Try: <em>\"How many native trees in Carlton?\"</em> or <em>\"Which SA2 has the highest canopy?\"</em>";
    }

    // ==================== MAP COMMANDS (text -> map actions) ====================

    // Layer keywords, checked in order — first match wins, so put specific phrases first
    var LAYER_KEYWORDS = [
        { re: /\bpark access\b/, layer: 'park-sa2' },
        { re: /\bcanopy( cover(age)?)?\b/, layer: 'canopy' },
        { re: /\b(tree )?diversity\b/, layer: 'diversity' },
        { re: /\btree origin\b|\borigin (layer|map)\b/, layer: 'origin-sa2' },
        { re: /\bbuildings?\b/, layer: 'buildings' },
        { re: /\bneigh(bou)?rhood names\b|\bnames layer\b/, layer: 'sa2-names' },
        { re: /\bparks\b/, layer: 'parks' },
        { re: /\bboundaries\b|\bsa2 bound/, layer: 'sa2' },
        { re: /\bmunicipal\b/, layer: 'municipal' },
        { re: /\btrees?\b/, layer: 'trees' }
    ];

    function findLayer(q) {
        for (var i = 0; i < LAYER_KEYWORDS.length; i++) {
            if (LAYER_KEYWORDS[i].re.test(q)) return LAYER_KEYWORDS[i].layer;
        }
        return null;
    }

    // Whole-word match, so "Oak" doesn't match inside another word and
    // punctuation in names ("Kensington (Vic.)") is matched literally
    function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
    function matchListWord(q, list) {
        for (var i = 0; i < list.length; i++) {
            var v = list[i];
            if (!v) continue;
            var re = new RegExp('(^|[^a-z0-9])' + escapeRe(v.toLowerCase()) + '($|[^a-z0-9])', 'i');
            if (re.test(q)) return v;
        }
        return null;
    }

    function setSelect(id, value) {
        var el = document.getElementById(id);
        if (el) el.value = value;
    }

    function syncLayerCheckbox(name, on) {
        var cb = document.querySelector('#panel-' + name + ' input[type=checkbox]');
        if (cb) cb.checked = on;
    }

    // Returns an HTML confirmation string if the text was handled as a command, else null
    function tryMapCommand(question) {
        var q = question.toLowerCase().trim();

        // Questions about the data are not commands — let the query engine answer them
        if (/\b(how many|which|what|who|why|when|where|top|most common|highest|lowest|average|compare|summary|overview|tell me about)\b/.test(q)) return null;

        var isCommand = /\b(show|display|filter|highlight|turn on|turn off|hide|remove|reset|clear|only)\b/.test(q);
        if (!isCommand) return null;

        var done = [];

        // --- Reset / clear everything ---
        if (/\b(reset|clear|start over|show (me )?(all|everything))\b/.test(q) && !findLayer(q)) {
            setSelect('area-filter', '');
            setAreaFilter('');
            resetTreeFilters();
            return 'Map reset — filters cleared and zoomed back to all of Melbourne.';
        }

        // --- Area filter: "filter to Carlton" ---
        var area = matchListWord(q, sa2NamesByLength);
        if (area) {
            setSelect('area-filter', area);
            setAreaFilter(area);
            done.push('zoomed to <span class="chat-highlight">' + area + '</span>');
        }

        // --- Tree attribute filters ---
        var origin = matchListWord(q, originValues);
        var endemic = /\bendemic\b/.test(q);
        var family = matchListWord(q, allFamilies);
        var species = matchListWord(q, allSpecies);
        var treeFilterUsed = origin || endemic || family || species;

        if (treeFilterUsed) {
            setSelect('filter-tree-origin', origin || '');
            setSelect('filter-tree-endemic', endemic ? 'true' : '');
            setSelect('filter-tree-family', family || '');
            setSelect('filter-tree-species', species || '');

            toggleLayer('trees', true);
            syncLayerCheckbox('trees', true);
            applyUITreeFilter();

            var what = [];
            if (origin) what.push(origin.toLowerCase());
            if (endemic) what.push('endemic');
            if (species) what.push(species);
            else if (family) what.push(family);
            done.push('showing only <span class="chat-highlight">' + what.join(' ') + '</span> trees');
        }

        // --- Layer on/off ---
        var layer = findLayer(q);
        var turningOff = /\b(turn off|hide|remove)\b/.test(q);
        if (layer && !(layer === 'trees' && treeFilterUsed)) {
            toggleLayer(layer, !turningOff);
            syncLayerCheckbox(layer, !turningOff);
            done.push((turningOff ? 'hid ' : 'showing ') + '<span class="chat-highlight">' + layerLabel(layer) + '</span>');
        }

        if (!done.length) return null;
        return 'Done — ' + done.join(' and ') + '.';
    }

    function layerLabel(name) {
        var labels = {
            'canopy': 'Canopy Coverage', 'diversity': 'Tree Diversity', 'origin-sa2': 'Tree Origin',
            'park-sa2': 'Park Access', 'buildings': 'Park Access (buildings)', 'trees': 'Trees',
            'parks': 'Parks', 'sa2': 'SA2 Boundaries', 'sa2-names': 'Neighborhood Names',
            'municipal': 'Municipal Boundary'
        };
        return labels[name] || name;
    }

    // ==================== UI FILTERS ====================

    function applyUITreeFilter() {
        var origin = document.getElementById('filter-tree-origin').value;
        var endemic = document.getElementById('filter-tree-endemic').value;
        var family = document.getElementById('filter-tree-family').value;
        var species = document.getElementById('filter-tree-species').value;

        var treesOn = map.hasLayer(activeTreeGroup);
        if (treesOn) map.removeLayer(activeTreeGroup);
        plainTreeGroup.clearLayers();

        var matching = currentFilter
            ? allTreeMarkers.filter(function (m) { return m.feature.properties._sa2 === currentFilter; })
            : allTreeMarkers;

        if (origin) matching = matching.filter(function (m) { return m.feature.properties.origin === origin; });
        if (endemic) matching = matching.filter(function (m) { return m.feature.properties.endemic === endemic; });
        if (family) matching = matching.filter(function (m) { return m.feature.properties.family === family; });
        if (species) matching = matching.filter(function (m) { return m.feature.properties.common_name === species; });

        matching.forEach(function (m) { plainTreeGroup.addLayer(m); });

        // Auto-enable trees layer if a filter is active
        var hasFilter = origin || endemic || family || species;
        if (hasFilter && !treesOn) treesOn = true;
        if (hasFilter) {
            var cb = document.querySelector('#panel-trees input[type=checkbox]');
            if (cb && !cb.checked) cb.checked = true;
        }
        if (treesOn) plainTreeGroup.addTo(map);
        layers.trees = plainTreeGroup;

        var countEl = document.querySelector('#panel-trees .layer-count');
        if (countEl) countEl.textContent = matching.length.toLocaleString();
    }

    function resetTreeFilters() {
        document.getElementById('filter-tree-origin').value = '';
        document.getElementById('filter-tree-endemic').value = '';
        document.getElementById('filter-tree-family').value = '';
        document.getElementById('filter-tree-species').value = '';
        applyUITreeFilter();
    }

    function applyBuildingFilter() {
        var access = document.getElementById('filter-buildings-access').value;
        var maxDist = parseInt(document.getElementById('filter-buildings-dist').value);
        document.getElementById('filter-buildings-dist-val').textContent = maxDist + 'm';

        var buildingsOn = map.hasLayer(layers.buildings);
        if (buildingsOn) map.removeLayer(layers.buildings);

        var baseData = filterSpatialData(json_building_nearest_parkbuilding_polygon_7);

        // Apply filters
        var filtered = {
            type: 'FeatureCollection',
            features: baseData.features.filter(function (f) {
                var p = f.properties;
                if (access && p.pass_fail_300 !== access) return false;
                if (p.routing_distance_m > maxDist) return false;
                return true;
            })
        };

        layerBuildings = createBuildingsLayer(filtered);
        layers.buildings = layerBuildings;
        geoJsonLayers.buildings = layerBuildings;
        if (buildingsOn) layerBuildings.addTo(map);

        // Auto-enable if filter active
        if ((access || maxDist < 1000) && !buildingsOn) {
            layerBuildings.addTo(map);
            var cb = document.querySelector('#panel-buildings input[type=checkbox]');
            if (cb && !cb.checked) cb.checked = true;
        }

        var countEl = document.querySelector('#panel-buildings .layer-count');
        if (countEl) countEl.textContent = filtered.features.length.toLocaleString();
    }

    // Populate tree filter dropdowns
    (function populateTreeFilterDropdowns() {
        var familySel = document.getElementById('filter-tree-family');
        var speciesSel = document.getElementById('filter-tree-species');
        if (!familySel || !speciesSel) return;

        // Get all unique families sorted by frequency
        var famFreq = {};
        json_trees_species_dim_8.features.forEach(function (f) {
            var v = f.properties.family;
            if (v) famFreq[v] = (famFreq[v] || 0) + 1;
        });
        Object.keys(famFreq).sort(function (a, b) { return famFreq[b] - famFreq[a]; })
            .forEach(function (fam) {
                var opt = document.createElement('option');
                opt.value = fam;
                opt.textContent = fam + ' (' + famFreq[fam].toLocaleString() + ')';
                familySel.appendChild(opt);
            });

        // Get all unique species sorted by frequency
        var spFreq = {};
        json_trees_species_dim_8.features.forEach(function (f) {
            var v = f.properties.common_name;
            if (v) spFreq[v] = (spFreq[v] || 0) + 1;
        });
        Object.keys(spFreq).sort(function (a, b) { return spFreq[b] - spFreq[a]; })
            .forEach(function (sp) {
                var opt = document.createElement('option');
                opt.value = sp;
                opt.textContent = sp + ' (' + spFreq[sp].toLocaleString() + ')';
                speciesSel.appendChild(opt);
            });
    })();

    // ==================== CHAT UI ====================

    function addMessage(text, sender) {
        var container = document.getElementById('chat-messages');
        var div = document.createElement('div');
        div.className = 'chat-msg ' + sender;
        div.innerHTML = text;
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
    }

    function ask() {
        var input = document.getElementById('chat-input');
        var question = input.value.trim();
        if (!question) return;
        input.value = '';
        addMessage(question, 'user');

        // Map commands first ("show only native trees"), then data questions
        var commandResult = tryMapCommand(question);
        addMessage(commandResult || smartAnswer(question), 'bot');
    }

    // ==================== INIT ====================

    updateLegend('canopy', 'grade');
    updateLegend('diversity', 'species_grade');
    updateLegend('origin-sa2', 'native_pct');
    updateLegend('park-sa2', 'grade');
    updateLegend('buildings', 'grade');
    updateLegend('trees', 'origin');

    // Populate area filter dropdown
    var areaSelect = document.getElementById('area-filter');
    if (areaSelect) {
        var names = json_SA2_Melbourne_boundaries_2.features.map(function (f) { return f.properties.sa2_name21; }).sort();
        names.forEach(function (n) {
            var opt = document.createElement('option');
            opt.value = n; opt.textContent = n;
            areaSelect.appendChild(opt);
        });
    }

    // ==================== TREE INFO PANEL (iNaturalist + Wikipedia) ====================

    var speciesCache = {};

    function showTreeInfo(p) {
        var panel = document.getElementById('tree-info-panel');
        var content = document.getElementById('tree-info-content');

        panel.classList.add('active');
        content.innerHTML = '<div class="tree-info-loading">Loading species info...</div>';

        var sci = p.scientific_name || '';
        var common = p.common_name || p.species_display || 'Unknown';
        var family = p.family || '';
        var genus = p.genus || '';

        // Build Victoria badges
        var vicBadges = '';
        if (p.origin === 'Native')      vicBadges += '<span class="tree-badge badge-native">Native to Victoria</span>';
        if (p.origin === 'Exotic')       vicBadges += '<span class="tree-badge badge-exotic">Exotic to Victoria</span>';
        if (p.origin === 'Introduced')   vicBadges += '<span class="tree-badge badge-introduced">Introduced to Victoria</span>';
        if (p.endemic === 'true')        vicBadges += '<span class="tree-badge badge-endemic">Endemic to Victoria</span>';

        var cacheKey = sci.replace(/ /g, '_');

        function render(data) {
            var photo = data.inatPhoto || data.wikiThumb || '';
            var photoAttr = data.inatPhotoAttr || '';
            var extract = data.wikiExtract || '';
            var wikiUrl = data.wikiUrl || '';
            var inatUrl = data.inatUrl || '';
            var conservationStatus = data.conservationStatus || '';
            var alaStatus = data.alaStatus || '';  // 'native', 'exotic', or ''
            var alaUrl = data.alaUrl || '';

            var html = '';

            // Photo
            if (photo) {
                html += '<img class="tree-info-photo" src="' + photo + '" alt="' + common + '">';
                if (photoAttr) html += '<div class="tree-info-photo-attr">' + photoAttr + '</div>';
            }

            // Title block
            html += '<h2>' + common + (sci ? ' <span class="tree-info-sci-inline">&middot; ' + sci + '</span>' : '') + '</h2>';
            if (family) html += '<div class="tree-info-row"><span>Family</span><span>' + family + '</span></div>';

            // Origin badges: Victoria line, then Australia line
            var allBadges = '';
            if (vicBadges) allBadges += '<div class="tree-info-badge-row">' + vicBadges + '</div>';
            if (alaStatus === 'native') {
                allBadges += '<div class="tree-info-badge-row"><span class="tree-badge badge-au-native">Native to Australia</span></div>';
            } else if (alaStatus === 'exotic') {
                allBadges += '<div class="tree-info-badge-row"><span class="tree-badge badge-au-exotic">Exotic to Australia</span></div>';
            }
            if (allBadges) html += '<div class="tree-info-badges">' + allBadges + '</div>';

            // Conservation status from iNaturalist
            if (conservationStatus) {
                html += '<div class="tree-info-row"><span>Conservation</span><span>' + conservationStatus + '</span></div>';
            }

            // Wikipedia description
            if (extract) {
                html += '<hr>';
                html += '<div class="tree-info-section-title">About This Species</div>';
                html += '<p class="tree-info-extract">' + extract + '</p>';
            }

            // Links
            html += '<div class="tree-info-links">';
            if (inatUrl) html += '<a class="tree-info-link" href="' + inatUrl + '" target="_blank" rel="noopener">View on iNaturalist &rarr;</a>';
            if (wikiUrl) html += '<a class="tree-info-link" href="' + wikiUrl + '" target="_blank" rel="noopener">Read on Wikipedia &rarr;</a>';
            if (alaUrl) html += '<a class="tree-info-link" href="' + alaUrl + '" target="_blank" rel="noopener">View on Atlas of Living Australia &rarr;</a>';
            if (!inatUrl && !wikiUrl && sci) {
                html += '<a class="tree-info-link" href="https://en.wikipedia.org/wiki/' + cacheKey + '" target="_blank" rel="noopener">Search Wikipedia &rarr;</a>';
            }
            html += '</div>';

            content.innerHTML = html;
        }

        // Check cache
        if (speciesCache[cacheKey]) { render(speciesCache[cacheKey]); return; }
        if (!sci) { render({}); return; }

        // Fetch all three APIs in parallel
        var inatPromise = fetch('https://api.inaturalist.org/v1/taxa?q=' + encodeURIComponent(sci) + '&rank=species&per_page=1')
            .then(function (r) { return r.json(); })
            .catch(function () { return { results: [] }; });

        var wikiPromise = fetch('https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(cacheKey))
            .then(function (r) { return r.json(); })
            .catch(function () { return {}; });

        var alaPromise = fetch('https://bie.ala.org.au/ws/species/lookup/bulk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ names: [sci] })
            })
            .then(function (r) { return r.json(); })
            .catch(function () { return []; });

        Promise.all([inatPromise, wikiPromise, alaPromise]).then(function (results) {
            var inat = results[0];
            var wiki = results[1];
            var ala = results[2];

            var merged = {};

            // iNaturalist data
            if (inat.results && inat.results.length > 0) {
                var taxon = inat.results[0];
                if (taxon.default_photo && taxon.default_photo.medium_url) {
                    merged.inatPhoto = taxon.default_photo.medium_url;
                    if (taxon.default_photo.attribution) {
                        merged.inatPhotoAttr = taxon.default_photo.attribution;
                    }
                }
                merged.inatUrl = 'https://www.inaturalist.org/taxa/' + taxon.id;
                if (taxon.conservation_status && taxon.conservation_status.status_name) {
                    merged.conservationStatus = taxon.conservation_status.status_name;
                }
            }

            // Wikipedia data
            if (wiki.type === 'standard') {
                merged.wikiExtract = wiki.extract || '';
                if (wiki.thumbnail) merged.wikiThumb = wiki.thumbnail.source;
                if (wiki.content_urls) merged.wikiUrl = wiki.content_urls.desktop.page;
            }

            // ALA data — determine Australian origin
            try {
                var alaResult = null;
                if (Array.isArray(ala) && ala.length > 0) {
                    alaResult = ala[0];
                }
                if (alaResult && alaResult.guid) {
                    merged.alaUrl = 'https://bie.ala.org.au/species/' + alaResult.guid;
                    // Check establishment means / native status from ALA kvp or properties
                    var kvp = alaResult.kvpValues || [];
                    var isNativeAU = false;
                    var isExoticAU = false;
                    for (var i = 0; i < kvp.length; i++) {
                        var key = (kvp[i].key || '').toLowerCase();
                        var val = (kvp[i].value || '').toLowerCase();
                        if (key.indexOf('establishment') !== -1 || key.indexOf('origin') !== -1 || key.indexOf('native') !== -1) {
                            if (val.indexOf('native') !== -1) isNativeAU = true;
                            if (val.indexOf('exotic') !== -1 || val.indexOf('introduced') !== -1 || val.indexOf('naturalised') !== -1) isExoticAU = true;
                        }
                    }
                    // Fallback heuristic: if the species is in APC (Australian Plant Census)
                    // and no explicit status found, infer from kingdom + name patterns
                    if (!isNativeAU && !isExoticAU) {
                        var nameAuth = (alaResult.author || '').toLowerCase();
                        var acceptedName = (alaResult.acceptedConceptName || alaResult.name || '').toLowerCase();
                        // Species with Australian type authorities or in APC are likely native
                        if (alaResult.rankString === 'species') {
                            // Check linked counts or other indicators
                            var infoSrc = (alaResult.infoSourceName || '').toLowerCase();
                            if (infoSrc.indexOf('apc') !== -1 || infoSrc.indexOf('australian plant census') !== -1) {
                                // APC listed — could be native or naturalised; check further
                                var isAustralianGenus = /^(eucalyptus|corymbia|melaleuca|acacia|banksia|grevillea|callistemon|leptospermum|allocasuarina|angophora|brachychiton|casuarina|ficus|flindersia|syzygium|tristaniopsis|waterhousea|xanthorrhoea)/i.test(sci);
                                if (isAustralianGenus) {
                                    isNativeAU = true;
                                }
                            }
                        }
                    }
                    if (isNativeAU) merged.alaStatus = 'native';
                    else if (isExoticAU) merged.alaStatus = 'exotic';
                }
            } catch (e) {
                // ALA failed — no Australia badge, that's fine
            }

            speciesCache[cacheKey] = merged;
            render(merged);
        });
    }

    function closeTreePanel() {
        document.getElementById('tree-info-panel').classList.remove('active');
    }

    // Close panel with Escape
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closeTreePanel();
    });

    // Close panel when clicking outside it (on the map)
    map.on('click', function () { closeTreePanel(); });

    // Precompute SA2 assignments in background
    setTimeout(precomputeSA2, 2000);

    // Hide loading
    setTimeout(function () {
        var el = document.getElementById('loading');
        if (el) { el.classList.add('done'); setTimeout(function () { el.remove(); }, 600); }
    }, 500);

    // Toggle collapsible filter sections
    function toggleFilter(toggleEl) {
        toggleEl.classList.toggle('collapsed');
        var filterGroup = toggleEl.nextElementSibling;
        if (filterGroup && filterGroup.classList.contains('filter-group')) {
            filterGroup.classList.toggle('collapsed');
        }
    }

    // Mutual exclusivity for park access layers
    function toggleParkAccess(name, on) {
        var other = (name === 'park-sa2') ? 'buildings' : 'park-sa2';
        if (on) {
            // Turn off the other layer
            toggleLayer(other, false);
            // Uncheck the other toggle
            var otherPanel = document.getElementById('panel-park-access');
            if (otherPanel) {
                var toggles = otherPanel.querySelectorAll('input[type="checkbox"]');
                toggles.forEach(function (cb) {
                    // Find the one whose onchange references the other layer
                    var handler = cb.getAttribute('onchange') || '';
                    if (handler.indexOf(other) >= 0) cb.checked = false;
                });
            }
        }
        toggleLayer(name, on);
    }

    // Public API
    return {
        updateStyle: updateStyle,
        toggleLayer: toggleLayer,
        toggleSidebar: toggleSidebar,
        togglePanel: togglePanel,
        toggleFilter: toggleFilter,
        toggleParkAccess: toggleParkAccess,
        ask: ask,
        setAreaFilter: setAreaFilter,
        closeTreePanel: closeTreePanel,
        applyUITreeFilter: applyUITreeFilter,
        resetTreeFilters: resetTreeFilters,
        applyBuildingFilter: applyBuildingFilter,
        map: map
    };

})();
