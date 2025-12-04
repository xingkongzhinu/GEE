/*
珠江口 2025 年碳密度反演（Sentinel-2）
论文级最终完整版本
*/

//================== 1. 研究区 ==================
var pearl_river_estuary = ee.Geometry.Polygon([
  [113.0, 21.5],
  [114.5, 21.5],
  [114.5, 22.5],
  [113.0, 22.5],
  [113.0, 21.5]
]);

Map.centerObject(pearl_river_estuary, 9);
Map.addLayer(pearl_river_estuary, {color: 'red'}, '珠江口研究区');

//================== 2. 参考碳密度 ==================
var carbon = ee.ImageCollection("WCMC/biomass_carbon_density/v1_0").first();

var carbonVis = {
  min: 0,
  max: 150,
  palette: ['#ffffcc', '#78c679', '#238443']
};

Map.addLayer(carbon.clip(pearl_river_estuary), carbonVis, '参考碳密度（WCMC）', false);

//================== 3. Sentinel-2 ==================
var sen2 = ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
  .filterBounds(pearl_river_estuary)
  .filterDate('2025-01-01', '2025-12-31')
  .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 10))
  .median()
  .select(['B2','B3','B4','B8','B11','B12'])
  .multiply(0.0001);

// NDVI
var ndvi = sen2.normalizedDifference(['B8', 'B4']).rename('NDVI');

//================== 4. 林地掩膜 ==================
var dw = ee.ImageCollection("GOOGLE/DYNAMICWORLD/V1")
  .select('label')
  .filterBounds(pearl_river_estuary)
  .filterDate('2025-01-01', '2025-12-31')
  .mode()
  .eq(1);

Map.addLayer(dw.clip(pearl_river_estuary), {palette: ['006400']}, '林地掩膜', false);

//================== 5. 自变量 ==================
var predictors = ee.Image.constant(1)
  .addBands(sen2)
  .addBands(ndvi)
  .updateMask(dw);

//================== 6. 回归 ==================
var dataset = predictors.addBands(carbon);

var model = dataset.reduceRegion({
  reducer: ee.Reducer.robustLinearRegression(8, 1),
  geometry: pearl_river_estuary,
  scale: 250,
  bestEffort: true,
  maxPixels: 1e13
});

// 系数
var coef = ee.Array(model.get('coefficients')).project([0]).toList();

//================== 7. 碳密度反演 ==================
var sen2_carbon = predictors
  .multiply(ee.Image.constant(coef))
  .reduce(ee.Reducer.sum())
  .rename('sen2_carbon');

Map.addLayer(sen2_carbon.clip(pearl_river_estuary), carbonVis, '反演碳密度（连续）', true);

//================== 8. 精度评估 ==================
var rmse = ee.Number(
  carbon.subtract(sen2_carbon).pow(2)
    .reduceRegion({
      reducer: ee.Reducer.mean(),
      geometry: pearl_river_estuary,
      scale: 250,
      bestEffort: true,
      maxPixels: 1e13
    }).values().get(0)
).sqrt();

print('RMSE (Mg C/ha):', rmse);

//================== 9. 分位数分类 ==================
var samples = sen2_carbon.sample({
  region: pearl_river_estuary,
  scale: 100,
  numPixels: 5000,
  geometries: false
});

var values = samples.aggregate_array('sen2_carbon');

var q33 = ee.Number(values.reduce(ee.Reducer.percentile([33])));
var q66 = ee.Number(values.reduce(ee.Reducer.percentile([66])));

print('33% 分位数:', q33);
print('66% 分位数:', q66);

// 分类
var low = sen2_carbon.lte(q33);
var mid = sen2_carbon.gt(q33).and(sen2_carbon.lte(q66));
var high = sen2_carbon.gt(q66);

var carbonClass = low.multiply(1)
  .add(mid.multiply(2))
  .add(high.multiply(3));

// 分类图
Map.addLayer(carbonClass.clip(pearl_river_estuary), {
  min: 1,
  max: 3,
  palette: ['#ffffcc', '#78c679', '#238443']
}, '2025年珠江口碳密度分级图');

//================== 10. 分类面积统计 ==================
function area(img){
  return img.selfMask().multiply(ee.Image.pixelArea()).divide(1e6)
    .reduceRegion({
      reducer: ee.Reducer.sum(),
      geometry: pearl_river_estuary,
      scale: 100,
      maxPixels: 1e13
    }).values().get(0);
}

var lowArea = ee.Number(area(low));
var midArea = ee.Number(area(mid));
var highArea = ee.Number(area(high));

print('低碳区面积(km²):', lowArea);
print('中碳区面积(km²):', midArea);
print('高碳区面积(km²):', highArea);

//================== 11. 中文图例 ==================
var legend = ui.Panel({
  style: {position:'bottom-right', padding:'10px', backgroundColor:'white'}
});

legend.add(ui.Label({
  value:'碳密度分级（Mg C/ha）',
  style:{fontWeight:'bold'}
}));

function row(color, text){
  return ui.Panel({
    widgets:[
      ui.Label('', {backgroundColor:color, padding:'8px'}),
      ui.Label(text, {margin:'0 0 0 6px'})
    ],
    layout: ui.Panel.Layout.Flow('horizontal')
  });
}

legend.add(row('#ffffcc','低碳区 (≤30)'));
legend.add(row('#78c679','中碳区 (30–40)'));
legend.add(row('#238443','高碳区 (>40)'));

Map.add(legend);

//================== 12. 面积柱状图 ==================
var areaFC = ee.FeatureCollection([
  ee.Feature(null, {type:'低碳区', area: lowArea}),
  ee.Feature(null, {type:'中碳区', area: midArea}),
  ee.Feature(null, {type:'高碳区', area: highArea})
]);

print(ui.Chart.feature.byFeature(areaFC, 'type', ['area'])
  .setChartType('ColumnChart')
  .setOptions({
    title:'碳密度分级面积统计',
    vAxis:{title:'面积 (km²)'},
    hAxis:{title:'2025年珠江口碳密度分级'}
  })
);

//================== 13. 月平均碳密度 ==================
var months = ee.List.sequence(1,12);

function monthlyCarbon(m){
  var start = ee.Date.fromYMD(2025,m,1);
  var end = start.advance(1,'month');
  var col = ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
    .filterBounds(pearl_river_estuary)
    .filterDate(start,end)
    .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE',10));

  return ee.Feature(null,{
    month: m,
    carbon: ee.Algorithms.If(col.size().gt(0),
      ee.Image(col.median())
        .select(['B2','B3','B4','B8','B11','B12'])
        .multiply(0.0001)
        .addBands(ee.Image(col.median()).normalizedDifference(['B8','B4']).rename('NDVI'))
        .addBands(ee.Image.constant(1))
        .rename(['B2','B3','B4','B8','B11','B12','NDVI','constant'])
        .updateMask(dw)
        .multiply(ee.Image.constant(coef))
        .reduce(ee.Reducer.sum())
        .reduceRegion({
          reducer: ee.Reducer.mean(),
          geometry: pearl_river_estuary,
          scale:100,
          maxPixels:1e13
        }).get('sum'),
      null)
  });
}

var monthlyStats = ee.FeatureCollection(months.map(monthlyCarbon));

print(ui.Chart.feature.byFeature(monthlyStats,'month',['carbon'])
  .setChartType('LineChart')
  .setOptions({
    title:'珠江口2025年逐月碳密度变化',
    hAxis:{title:'月份'},
    vAxis:{title:'Mg C/ha'},
    interpolateNulls:true,
    pointSize:5,
    lineWidth:2
  })
);
