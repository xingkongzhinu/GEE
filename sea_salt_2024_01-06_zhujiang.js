/*
  珠江口2024年1-6月盐度分析
  功能：1. 核心点月度盐度趋势图 2. 近岸/外海月度对比图 3. 1-6月平均盐度可视化（带图例）
*/

// ---------------------- 1. 固定采样位置定义（修正海域点位） ----------------------
// 珠江口研究区边界
var pearl_river_estuary = ee.Geometry.Polygon([
  [113.5, 21.5],    // 西南角
  [114.0, 21.5],    // 东南角
  [114.0, 22.3],    // 东北角
  [113.5, 22.3],    // 西北角
  [113.5, 21.5]     // 闭合
], null, false);

// 固定监测点（全部调整为珠江口海域，避免陆地）
var core_point = ee.Geometry.Point([113.8, 22.0]);       // 核心点（伶仃洋海域）
var near_shore_point = ee.Geometry.Point([113.6, 22.0]); // 近岸点（伶仃洋近岸海域，原点位修正）
var off_shore_point = ee.Geometry.Point([114.0, 21.5]);  // 外海点（珠江口外海海域，原点位修正）
var comparison_points = ee.FeatureCollection([
  ee.Feature(near_shore_point, {name: '近岸点'}),
  ee.Feature(off_shore_point, {name: '外海点'})
]);

// 地图初始化（居中珠江口，缩放级别10）
Map.centerObject(pearl_river_estuary, 10);
Map.addLayer(pearl_river_estuary, {color: 'red'}, '珠江口研究区', true);
Map.addLayer(core_point, {color: 'blue'}, '核心监测点', true);
Map.addLayer(comparison_points, {color: 'green'}, '对比监测点', true);

// ---------------------- 2. 2024年1-6月盐度数据加载与预处理 ----------------------
// 定义时间范围：2024年1月1日 - 2024年6月30日
var startDate = ee.Date('2024-01-01');
var endDate = ee.Date('2024-06-30');

// 月度降采样函数（服务器端实现，避免5000元素超限）
function monthlyMeanCollection(collection, startDate, endDate) {
  var months = ee.Number(endDate.difference(startDate, 'month')).round();
  var monthList = ee.List.sequence(0, months.subtract(1));
  return ee.ImageCollection(monthList.map(function(monthOffset) {
    var start = startDate.advance(monthOffset, 'month');
    var end = start.advance(1, 'month');
    // 筛选当月数据并计算均值
    var monthlyMean = collection
      .filterDate(start, end)
      .select('salinity_0')
      .map(function(img) {
        // 盐度校正：0.001缩放 + 20偏移（还原为PSU）
        var sss = img.multiply(0.001).add(20);
        // 过滤异常值（20-40 PSU为有效范围）
        return sss.mask(sss.gt(20).and(sss.lt(40))).rename('SSS');
      })
      .mean();
    // 强制绑定时间属性（图表x轴必需）
    return monthlyMean
      .set('system:time_start', start.millis())
      .set('date', start.format('YYYY-MM'));
  }));
}

// 加载HYCOM盐度数据并生成2024年1-6月月度均值集合
var salinity_monthly = monthlyMeanCollection(
  ee.ImageCollection("HYCOM/sea_temp_salinity")
    .filterDate(startDate, endDate)
    .filterBounds(pearl_river_estuary),
  startDate,
  endDate
)
// 过滤无效影像（确保有时间属性和有效波段）
.filter(ee.Filter.notNull(['system:time_start']))
.filter(ee.Filter.listContains('system:band_names', 'SSS'))
.sort('system:time_start');

// 数据有效性校验
print('2024年1-6月有效月度影像数：', salinity_monthly.size());
print('数据时间范围：', 
  ee.Date(salinity_monthly.first().get('system:time_start')).format('YYYY-MM'),
  '至',
  ee.Date(salinity_monthly.sort('system:time_start', false).first().get('system:time_start')).format('YYYY-MM')
);

// ---------------------- 3. 2024年1-6月平均盐度图（带色彩图例） ----------------------
// 计算2024年1-6月平均盐度
var salinity_2024_1_6_mean = salinity_monthly.mean();

// 盐度可视化参数（适配珠江口25-35 PSU范围）
var visParams = {
  min: 25, 
  max: 35, 
  palette: ['darkblue', 'blue', 'cyan', 'lightgreen', 'yellow', 'orange', 'red']
};

// 添加平均盐度图层到地图
Map.addLayer(salinity_2024_1_6_mean.clip(pearl_river_estuary), visParams, '2024年1-6月平均盐度', true);

// 构建自定义色彩图例（右下角，带白色背景）
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
  value: '海面盐度 (PSU)',
  style: {
    fontWeight: 'bold',
    fontSize: '14px',
    margin: '0 0 6px 0'
  }
});
legend.add(legendTitle);

// 图例颜色块+标签生成函数
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

// 生成图例刻度（25-35 PSU，间隔2）
var palette = visParams.palette;
var legendLabels = ['25', '27', '29', '31', '33', '35'];
for (var i = 0; i < palette.length; i++) {
  legend.add(makeLegendRow(palette[i], legendLabels[i]));
}

// 将图例添加到地图
Map.add(legend);

// ---------------------- 4. 核心点月度盐度趋势图（2024年1-6月） ----------------------
var collSize = salinity_monthly.size().getInfo();
if (collSize > 0) {
  // 4.1 核心点月度盐度趋势图
  print('=== 珠江口核心点月度盐度趋势（2024年1-6月） ===',
    ui.Chart.image.series({
      imageCollection: salinity_monthly,
      region: core_point,
      reducer: ee.Reducer.first(),
      scale: 9000,  // HYCOM原生分辨率
      xProperty: 'system:time_start'
    }).setOptions({
      title: '珠江口核心点盐度变化（2024年1-6月）',
      vAxis: {title: '盐度 (PSU)', minValue: 25, maxValue: 35},
      hAxis: {title: '月份', format: 'YYYY-MM'},
      lineWidth: 3,
      pointSize: 5,
      colors: ['#FF6B6B'],
      legend: {position: 'none'},
      annotations: [{
        text: '伶仃洋核心点（113.8,22.0）',
        x: '2024-01-01',
        y: 35,
        fontSize: 12,
        color: '#FF6B6B'
      }]
    })
  );

  // 4.2 近岸/外海月度对比盐度图表（修正点位标注）
  print('=== 珠江口近岸vs外海月度盐度对比（2024年1-6月） ===',
    ui.Chart.image.seriesByRegion({
      imageCollection: salinity_monthly,
      regions: comparison_points,
      reducer: ee.Reducer.first(),
      band: 'SSS',
      scale: 9000,
      xProperty: 'system:time_start',
      seriesProperty: 'name'
    }).setOptions({
      title: '珠江口近岸/外海盐度对比（2024年1-6月）',
      vAxis: {title: '盐度 (PSU)', minValue: 25, maxValue: 35},
      hAxis: {title: '月份', format: 'YYYY-MM'},
      lineWidth: 3,
      pointSize: 4,
      series: {
        0: {color: '#4ECDC4', labelInLegend: '近岸点（113.6,22.0）- 伶仃洋近岸'},
        1: {color: '#1A535C', labelInLegend: '外海点（114.0,21.9）- 珠江口外海'}
      },
      legend: {position: 'top-right'}
    })
  );
}
