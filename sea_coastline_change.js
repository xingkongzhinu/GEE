/*
  珠江口2024-2025年海岸线变化监测（修复版）
  修复问题：1. change_val.eq is not a function 2. No band named 'constant'
  功能：NDWI计算 + 海岸线变化检测 + 可视化（带图例） + 矢量/栅格导出
*/

// ---------------------- 1. 定义珠江口研究区域 ----------------------
var pearl_river_estuary = ee.Geometry.Polygon([
  [113.0, 21.5],    // 西南角
  [114.5, 21.5],    // 东南角
  [114.5, 22.5],    // 东北角
  [113.0, 22.5],    // 西北角
  [113.0, 21.5]     // 闭合
], null, false);

Map.centerObject(pearl_river_estuary, 10);
Map.addLayer(pearl_river_estuary, {color: 'red'}, '珠江口研究区', true);

// ---------------------- 2. NDWI计算（2024/2025年） ----------------------
function calculateNDWIWaterMask(startYear, endYear, roi) {
  return ee.ImageCollection("MODIS/061/MOD09Q1")
    .filterDate(startYear, endYear)       
    .filterBounds(roi)                   
    .map(function(img) {
      var bands = img.select('sur.*').multiply(0.0001);
      // 计算NDWI并命名为constant（解决波段名错误）
      var ndwi = bands.normalizedDifference(['sur_refl_b01', 'sur_refl_b02']).rename('constant');
      return ndwi.copyProperties(img, ['system:time_start']);
    })
    .median()                            
    .gt(0.1);                            
}

// 计算2024/2025年水体掩膜
var water_2024 = calculateNDWIWaterMask('2024', '2025', pearl_river_estuary);
var water_2025 = calculateNDWIWaterMask('2025', '2026', pearl_river_estuary);

// 添加水体图层（修正可视化参数）
Map.addLayer(water_2024.clip(pearl_river_estuary), {palette: ['white', 'blue']}, '2024年水体', true);
Map.addLayer(water_2025.clip(pearl_river_estuary), {palette: ['white', 'darkblue']}, '2025年水体', false);

// ---------------------- 3. 海岸线变化检测 ----------------------
var coastline_change = water_2024.subtract(water_2025);

// 分类掩膜（修正波段名）
var erosion = coastline_change.eq(-1).updateMask(coastline_change.eq(-1));    // 侵蚀
var accretion = coastline_change.eq(1).updateMask(coastline_change.eq(1));    // 淤积
var no_change = coastline_change.eq(0).updateMask(coastline_change.eq(0));    // 无变化

// ---------------------- 4. 自定义变化图例 + 可视化（核心修复） ----------------------
// 修正可视化参数（波段名匹配constant）
var changeVisParams = {
  min: -1,
  max: 1,
  palette: ['red', 'white', 'green']  // red=侵蚀，white=无变化，green=淤积
};

// 添加海岸线变化图层（无需指定bands，自动匹配）
Map.addLayer(coastline_change.clip(pearl_river_estuary), changeVisParams, '2024-2025海岸线变化', true);

// 构建自定义图例面板
var legend = ui.Panel({
  style: {
    position: 'bottom-right',
    padding: '8px 15px',
    backgroundColor: 'white',
    border: '1px solid #ccc'
  }
});

// 图例标题
var legendTitle = ui.Label({
  value: '珠江口海岸线变化（2024-2025）',
  style: {
    fontWeight: 'bold',
    fontSize: '14px',
    margin: '0 0 8px 0'
  }
});
legend.add(legendTitle);

// 图例行生成函数
var makeLegendRow = function(color, label) {
  var colorBox = ui.Label({
    style: {
      backgroundColor: color,
      padding: '8px',
      margin: '0 0 4px 0',
      width: '20px',
      textAlign: 'center'
    }
  });
  var labelText = ui.Label({
    value: label,
    style: {margin: '0 0 4px 6px', fontSize: '12px'}
  });
  return ui.Panel({
    widgets: [colorBox, labelText],
    layout: ui.Panel.Layout.Flow('horizontal')
  });
};

// 添加图例项
legend.add(makeLegendRow('red', '海岸线侵蚀（后退）'));
legend.add(makeLegendRow('white', '无变化'));
legend.add(makeLegendRow('green', '海岸线淤积（前进）'));
Map.add(legend);



// ---------------------- 7. 变化面积统计 ----------------------
var area_calc = function(img) {
  var area = img.multiply(ee.Image.pixelArea()).divide(1e6);
  return area.reduceRegion({
    reducer: ee.Reducer.sum(),
    geometry: pearl_river_estuary,
    scale: 250,
    maxPixels: 1e13
  }).get('constant');
};

var erosion_area = ee.Number(area_calc(erosion));
var accretion_area = ee.Number(area_calc(accretion));

// 打印面积统计
print('=== 2024-2025珠江口海岸线变化面积 ===');
print('侵蚀面积（平方公里）：', erosion_area);
print('淤积面积（平方公里）：', accretion_area);
print('净变化面积（平方公里）：', accretion_area.subtract(erosion_area));

// ---------------------- 10. 2024 年逐月：水体 + 侵蚀 + 淤积 三条折线 ----------------------

// 生成月份列表
var months = ee.List.sequence(1, 12);

// 月度统计函数
function monthlyCoastStats(month) {
  month = ee.Number(month);
  
  var start = ee.Date.fromYMD(2024, month, 1);
  var end   = start.advance(1, 'month');
  
  var water = calculateNDWIWaterMask(start, end, pearl_river_estuary);

  // 侵蚀：当月是水体，上月不是水体
  var prevWater = calculateNDWIWaterMask(start.advance(-1, 'month'), start, pearl_river_estuary);
  var erosion   = prevWater.subtract(water).eq(1).selfMask();

  // 淤积：当月不是水体，上月是水体
  var accretion = water.subtract(prevWater).eq(1).selfMask();

  // 面积计算函数
  function area(img) {
    return img.multiply(ee.Image.pixelArea()).divide(1e6)
      .reduceRegion({
        reducer: ee.Reducer.sum(),
        geometry: pearl_river_estuary,
        scale: 250,
        maxPixels: 1e13
      }).get('constant');
  }

  // 计算面积
  var waterArea    = ee.Number(area(water));
  var erosionArea  = ee.Number(area(erosion));
  var accretionArea= ee.Number(area(accretion));

  return ee.Feature(null, {
    '月度': month,
    '水体': waterArea,
    '侵蚀': erosionArea,
    '淤积': accretionArea
  });
}

var monthlyData = ee.FeatureCollection(months.map(monthlyCoastStats));

// 输出数据表
print('2024年逐月变化统计表', monthlyData);


// ---------------------- 11. 绘制三条折线图 ----------------------
var chart = ui.Chart.feature.byFeature({
  features: monthlyData,
  xProperty: '月度',
  yProperties: ['水体', '侵蚀', '淤积']
})
.setChartType('LineChart')
.setOptions({
  title: '2024年珠江口月度水体 / 侵蚀 / 淤积 变化趋势',
  hAxis: {
    title: '月份',
    gridlines: {count: 12}
  },
  vAxis: {
    title: '面积（km²）'
  },
  lineWidth: 2,
  pointSize: 4,
  colors: ['#1f78b4', '#e31a1c', '#33a02c'],
  legend: {position: 'top'}
});

print(chart);
