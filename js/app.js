var App = (function () {
    'use strict';

    // ==================== COLOR SCALES ====================

    var GRADE_COLORS = {
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
        g = Math.round(Math.max(-5, Math.min(5, g)));
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

    L.tileLayer('https://a.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}@2x.png', {
        attribution: '&copy; CartoDB &copy; OpenStreetMap',
        maxNativeZoom: 20, maxZoom: 20
    }).addTo(map);

    // Panes (z-order)
    ['municipal', 'parks', 'sa2', 'canopy', 'diversity', 'origin-sa2', 'buildings', 'trees'].forEach(function (name, i) {
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
    var topSpecies = topValues(json_trees_species_dim_8, 'species_display', 10);

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
        if (p.origin) html += row('Origin', p.origin);
        if (p.family) html += row('Family', p.family);
        if (p.genus) html += row('Genus', p.genus);
        if (p.endemic === 'true') html += row('Endemic', 'Yes');
        if (p.age_description) html += row('Age', p.age_description);
        if (p.year_planted) html += row('Planted', p.year_planted);
        if (p.located_in) html += row('Located in', p.located_in);
        if (p.diameter_breast_height) html += row('DBH', p.diameter_breast_height);
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

    function styleTree(feature, mode) {
        var p = feature.properties, fill;
        if (mode === 'origin') fill = ORIGIN_COLORS[p.origin] || '#888';
        else if (mode === 'endemic') fill = ENDEMIC_COLORS[p.endemic] || '#888';
        else if (mode === 'family') fill = catColor(p.family, topFamilies);
        else if (mode === 'genus') fill = catColor(p.genus, topGenera);
        else if (mode === 'species') fill = catColor(p.species_display, topSpecies);
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
        'buildings': layerBuildings,
        'trees': activeTreeGroup,
        'parks': layerParks,
        'sa2': layerSA2,
        'municipal': layerMunicipal
    };

    var styleFns = {
        'canopy': styleCanopy,
        'diversity': styleDiv,
        'origin-sa2': styleOriginSA2,
        'buildings': styleBuilding
    };

    var geoJsonLayers = {
        'canopy': layerCanopy,
        'diversity': layerDiversity,
        'origin-sa2': layerOriginSA2,
        'buildings': layerBuildings
    };

    // ==================== LEGEND RENDERING ====================

    function renderGradeLegend(el) {
        var html = '';
        for (var g = -5; g <= 5; g++) {
            html += '<div class="legend-item"><span class="legend-swatch" style="background:' + GRADE_COLORS[String(g)] + '"></span>' + (g > 0 ? '+' : '') + g + '</div>';
        }
        el.innerHTML = html;
    }

    function renderPassFailLegend(el, labels) {
        el.innerHTML =
            '<div class="legend-item"><span class="legend-swatch" style="background:#27ae60"></span>' + (labels ? labels[0] : 'Pass') + '</div>' +
            '<div class="legend-item"><span class="legend-swatch" style="background:#c0392b"></span>' + (labels ? labels[1] : 'Fail') + '</div>';
    }

    function renderGradientLegend(el, minLabel, maxLabel, colors) {
        el.innerHTML =
            '<div class="legend-gradient">' +
            '<div class="legend-gradient-bar" style="background:linear-gradient(to right,' + colors.join(',') + ')"></div>' +
            '<div class="legend-gradient-labels"><span>' + minLabel + '</span><span>' + maxLabel + '</span></div>' +
            '</div>';
    }

    function renderCatLegend(el, items, colorFn) {
        var html = '';
        items.forEach(function (item) {
            html += '<div class="legend-item"><span class="legend-swatch" style="background:' + colorFn(item) + '"></span>' + item + '</div>';
        });
        html += '<div class="legend-item"><span class="legend-swatch" style="background:#888"></span>Other</div>';
        el.innerHTML = html;
    }

    function updateLegend(layerName, mode) {
        var el = document.getElementById('legend-' + layerName);
        if (!el) return;

        if (layerName === 'canopy') {
            if (mode === 'grade') renderGradeLegend(el);
            else if (mode === 'passfail') renderPassFailLegend(el);
            else renderGradientLegend(el, '0%', '55%', SEQ_GREEN);
        }
        else if (layerName === 'diversity') {
            if (mode.indexOf('grade') >= 0) renderGradeLegend(el);
            else renderPassFailLegend(el);
        }
        else if (layerName === 'origin-sa2') {
            if (mode === 'native_pct') renderGradientLegend(el, '0%', '80%', SEQ_GREEN);
            else if (mode === 'exotic_pct') renderGradientLegend(el, '0%', '80%', SEQ_RED);
            else if (mode === 'introduced_pct') renderGradientLegend(el, '0%', '50%', SEQ_BLUE);
            else renderGradientLegend(el, '0', '50', SEQ_GOLD);
        }
        else if (layerName === 'buildings') {
            if (mode === 'grade') renderGradeLegend(el);
            else if (mode === 'passfail') renderPassFailLegend(el);
            else renderGradientLegend(el, '0 m', '1000 m', DIST_SCALE);
        }
        else if (layerName === 'trees') {
            if (mode === 'origin') {
                el.innerHTML =
                    '<div class="legend-item"><span class="legend-swatch" style="background:#27ae60"></span>Native</div>' +
                    '<div class="legend-item"><span class="legend-swatch" style="background:#f39c12"></span>Introduced</div>' +
                    '<div class="legend-item"><span class="legend-swatch" style="background:#c0392b"></span>Exotic</div>';
            }
            else if (mode === 'endemic') {
                el.innerHTML =
                    '<div class="legend-item"><span class="legend-swatch" style="background:#f1c40f"></span>Endemic</div>' +
                    '<div class="legend-item"><span class="legend-swatch" style="background:#95a5a6"></span>Not Endemic</div>';
            }
            else if (mode === 'family') renderCatLegend(el, topFamilies, function (v) { return catColor(v, topFamilies); });
            else if (mode === 'genus') renderCatLegend(el, topGenera, function (v) { return catColor(v, topGenera); });
            else if (mode === 'species') renderCatLegend(el, topSpecies, function (v) { return catColor(v, topSpecies); });
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

        // Buildings: rebuild with filtered data
        var buildingsOn = map.hasLayer(layers.buildings);
        if (buildingsOn) map.removeLayer(layers.buildings);
        layerBuildings = createBuildingsLayer(filterSpatialData(json_building_nearest_parkbuilding_polygon_7));
        layers.buildings = layerBuildings;
        geoJsonLayers.buildings = layerBuildings;
        if (buildingsOn) layerBuildings.addTo(map);

        // Trees: swap markers in/out of plain group
        var treesOn = map.hasLayer(plainTreeGroup);
        if (treesOn) map.removeLayer(plainTreeGroup);
        plainTreeGroup.clearLayers();

        var matching = currentFilter
            ? allTreeMarkers.filter(function (m) { return m.feature.properties._sa2 === currentFilter; })
            : allTreeMarkers;
        matching.forEach(function (m) { plainTreeGroup.addLayer(m); });
        if (treesOn) plainTreeGroup.addTo(map);

        // Update tree count in sidebar
        var countEl = document.querySelector('#panel-trees .layer-count');
        if (countEl) countEl.textContent = matching.length.toLocaleString();
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
        if (speciesMatch) result = result.filter(function (f) { return f.properties.species_display === speciesMatch; });

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
            var prop = 'species_display';
            if (/family|families/i.test(q)) prop = 'family';
            else if (/genus|genera/i.test(q)) prop = 'genus';
            var ranked = freqCount(f.trees, prop);
            if (ranked.length === 0) return 'No matching trees found.';
            var top5 = ranked.slice(0, 5);
            var label = prop === 'species_display' ? 'species' : prop;
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
            var topSp = freqCount(f.trees, 'species_display').slice(0, 3);
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

    // ==================== GEMINI AI ====================

    var geminiKey = localStorage.getItem('gemini_api_key') || '';

    var DATA_SCHEMA = 'Datasets:\n' +
        '1. trees (82,064 records): common_name, scientific_name, genus, family, origin (Native/Introduced/Exotic), endemic (true/false), age_description, year_planted, precinct, diameter_breast_height, species_display\n' +
        '2. sa2_canopy (18 SA2 areas): sa2_name21, canopy_percent, canopy_grade_5 (-5 to +5), pass_fail_30\n' +
        '3. sa2_diversity (18 SA2 areas): sa2_name21, total_trees, max_species_pct, max_genus_pct, max_family_pct, species_grade, genus_grade, family_grade, species_pass, genus_pass, family_pass\n' +
        '4. sa2_origin (18 SA2 areas): sa2_name21, total_trees, native_percent, introduced_percent, exotic_percent, endemic_count\n' +
        '5. buildings (15,225 records): routing_distance_m, pass_fail_300, park_access_grade\n';

    function buildGeminiPrompt(question, localAnswer) {
        var stats = 'Quick stats: ' + trees.length + ' total trees, ' + sa2Names.length + ' SA2 neighborhoods (' + sa2Names.join(', ') + ').\n';
        stats += 'Precincts: ' + precincts.join(', ') + '.\n';
        stats += 'Top species: ' + topSpecies.join(', ') + '.\n';
        stats += 'Top families: ' + topFamilies.join(', ') + '.\n';
        if (localAnswer) stats += '\nLocal query engine result: ' + localAnswer.replace(/<[^>]+>/g, '') + '\n';

        return 'You are a helpful assistant for the Melbourne Urban Forest Dashboard. You answer questions about urban trees, canopy coverage, tree diversity, and park accessibility in the City of Melbourne.\n\n' +
            DATA_SCHEMA + '\n' + stats + '\n' +
            'Answer this question concisely (2-3 sentences max). Use specific numbers from the local query result if provided. If you cannot answer from the data provided, say so.\n\n' +
            'Question: ' + question;
    }

    async function askGemini(question) {
        if (!geminiKey) return null;
        var localAnswer = smartAnswer(question);
        var prompt = buildGeminiPrompt(question, localAnswer);
        try {
            var resp = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + geminiKey, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { maxOutputTokens: 300 }
                })
            });
            var data = await resp.json();
            if (data.candidates && data.candidates[0]) {
                return data.candidates[0].content.parts[0].text;
            }
            return null;
        } catch (e) {
            return null;
        }
    }

    // ==================== CHAT UI ====================

    function addMessage(text, sender) {
        var container = document.getElementById('chat-messages');
        var div = document.createElement('div');
        div.className = 'chat-msg ' + sender;
        div.innerHTML = text;
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
    }

    async function ask() {
        var input = document.getElementById('chat-input');
        var question = input.value.trim();
        if (!question) return;
        input.value = '';
        addMessage(question, 'user');

        if (geminiKey) {
            addMessage('<em>Thinking...</em>', 'bot');
            var aiAnswer = await askGemini(question);
            var msgs = document.getElementById('chat-messages');
            msgs.removeChild(msgs.lastChild);
            if (aiAnswer) {
                addMessage(aiAnswer, 'bot');
            } else {
                addMessage(smartAnswer(question), 'bot');
            }
        } else {
            addMessage(smartAnswer(question), 'bot');
        }
    }

    function showAISettings() {
        document.getElementById('ai-modal').style.display = 'flex';
        var input = document.getElementById('gemini-key-input');
        if (geminiKey) input.value = geminiKey;
    }

    function saveAIKey() {
        var key = document.getElementById('gemini-key-input').value.trim();
        var status = document.getElementById('ai-status');
        if (!key) {
            geminiKey = '';
            localStorage.removeItem('gemini_api_key');
            status.textContent = 'Key removed. Using smart engine.';
            status.className = 'ai-status err';
            document.getElementById('ai-connect-btn').classList.remove('connected');
            document.getElementById('ai-connect-btn').textContent = 'Connect Gemini AI (optional)';
            return;
        }
        geminiKey = key;
        localStorage.setItem('gemini_api_key', key);
        status.textContent = 'Key saved! Gemini AI is now active.';
        status.className = 'ai-status ok';
        document.getElementById('ai-connect-btn').classList.add('connected');
        document.getElementById('ai-connect-btn').textContent = 'Gemini AI connected';
        setTimeout(function () { document.getElementById('ai-modal').style.display = 'none'; }, 1200);
    }

    // Check if key already saved
    if (geminiKey) {
        var btn = document.getElementById('ai-connect-btn');
        if (btn) { btn.classList.add('connected'); btn.textContent = 'Gemini AI connected'; }
    }

    // ==================== INIT ====================

    updateLegend('canopy', 'grade');
    updateLegend('diversity', 'species_grade');
    updateLegend('origin-sa2', 'native_pct');
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

    // Precompute SA2 assignments in background
    setTimeout(precomputeSA2, 2000);

    // Hide loading
    setTimeout(function () {
        var el = document.getElementById('loading');
        if (el) { el.classList.add('done'); setTimeout(function () { el.remove(); }, 600); }
    }, 500);

    // Public API
    return {
        updateStyle: updateStyle,
        toggleLayer: toggleLayer,
        toggleSidebar: toggleSidebar,
        togglePanel: togglePanel,
        ask: ask,
        showAISettings: showAISettings,
        saveAIKey: saveAIKey,
        setAreaFilter: setAreaFilter,
        map: map
    };

})();
