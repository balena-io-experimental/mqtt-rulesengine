$(document).ready(function () {
  var
    socket = io(),
    charts = {},
    series = {},
    maxSeries = 0

  Highcharts.setOptions({
    global: {
      useUTC: false
    }
  });

  socket.on('connect', () => {
    socket.emit('clients', 'browser client connected');
  });

  socket.on('addEvent', function (data) {
    _.forEach(charts, function (chart) {

      // try to get the current series
      var currentSeries = _.get(series, data.device, null)
      if (currentSeries == null) {
        // if we haven't plotted this series yet, create a new series
        _.set(series, data.device, maxSeries)
        currentSeries = _.get(series, data.device)
        maxSeries = maxSeries + 1
      }

      if (chart.series[currentSeries] == null) {
        chart.addSeries({
          type: 'flags',
          name: 'Events',
          shape: 'squarepin',
          y: -30,
          data: [],
          showInLegend: false
        })
      }

      chart.series[currentSeries].addPoint({
        x: (new Date()).getTime(),
        title: 'motion triggered',
      }, true, appendPoint(chart, 0, 500));
    })
  })

  socket.on('updateChart', function (data) {
    // create a chart for this kind of data, if we don't have one yet
    if (_.get(charts, data.kind) == null) {
      _.set(charts, data.kind, renderChart(data.kind))
    }

    // get the chart we're working with
    var chart = _.get(charts, data.kind)

    // try to get the current series
    var currentSeries = _.get(series, data.device, null)
    if (currentSeries == null) {
      // if we haven't plotted this series yet, create a new series
      _.set(series, data.device, maxSeries)
      currentSeries = _.get(series, data.device)
      maxSeries = maxSeries + 1
    }

    if (chart.series[currentSeries] == null) {
      chart.addSeries({
        name: `${data.device_name} (${data.device})`,
        data: []
      })
    }

    chart.series[currentSeries]
      .addPoint([data.timestamp, data.value], true, appendPoint(chart, 0, 10000));

    //gauge.series[0].points[0].update(data.temperature)
  });
});

var appendPoint = function (chart, series, min) {
  return (chart.series[series].data.length >= min ? true : false)
}

var renderChart = function (container) {
  $("body").append("<div id=\"" + container + "\"></div>")

  return Highcharts.chart(container, {
    chart: {
      type: 'spline',
      animation: Highcharts.svg, // don't animate in old IE
      marginRight: 10,
      zoomType: 'x'
    },
    title: {
      text: container,
    },
    xAxis: {
      type: 'datetime',
      tickPixelInterval: 150
    },
    yAxis: [{
      plotLines: [{
        value: 0,
        width: 1,
        color: '#808080'
      }]
    }],
    tooltip: {
      formatter: function () {
        return '<b>' + this.series.name + '</b><br/>' +
          Highcharts.dateFormat('%Y-%m-%d %H:%M:%S', this.x) + '<br/>' +
          Highcharts.numberFormat(this.y, 2);
      }
    },
    legend: {
      enabled: false
    },
    plotOptions: {
      area: {
        fillColor: {
          linearGradient: {
            x1: 0,
            y1: 0,
            x2: 0,
            y2: 1
          },
          stops: [
            [0, Highcharts.getOptions().colors[0]],
            [1, Highcharts.Color(Highcharts.getOptions().colors[0]).setOpacity(0).get('rgba')]
          ]
        },
        marker: {
          radius: 2
        },
        lineWidth: 1,
        states: {
          hover: {
            lineWidth: 1
          }
        },
        threshold: null
      }
    },
    exporting: {
      enabled: true
    },
    series: []
  });
}


/* unused (yet) gauge rendering
var renderGauge = function (container) {
  var gaugeOptions = {

    chart: {
      type: 'solidgauge'
    },

    title: null,

    pane: {
      center: ['50%', '85%'],
      size: '140%',
      startAngle: -90,
      endAngle: 90,
      background: {
        backgroundColor: (Highcharts.theme && Highcharts.theme.background2) || '#EEE',
        innerRadius: '60%',
        outerRadius: '100%',
        shape: 'arc'
      }
    },

    tooltip: {
      enabled: false
    },

    // the value axis
    yAxis: {
      stops: [
        [0.1, '#55BF3B'], // green
        [0.5, '#DDDF0D'], // yellow
        [0.9, '#DF5353'] // red
      ],
      lineWidth: 0,
      minorTickInterval: null,
      tickAmount: 2,
      title: {
        y: -70
      },
      labels: {
        y: 16
      }
    },

    plotOptions: {
      solidgauge: {
        dataLabels: {
          y: 5,
          borderWidth: 0,
          useHTML: true
        }
      }
    }
  };

  return Highcharts.chart(container, Highcharts.merge(gaugeOptions, {
    yAxis: {
      min: 0,
      max: 100,
      title: {
        text: 'Temperature'
      }
    },
    credits: {
      enabled: false
    },
    series: [{
      name: 'Temperature',
      data: [0],
      dataLabels: {
        format: '<div style="text-align:center"><span style="font-size:25px;color:' +
        ((Highcharts.theme && Highcharts.theme.contrastTextColor) || 'black') +
        '">{y}</span><br/>' +
        '<span style="font-size:12px;color:silver">°F</span></div>'
      },
      tooltip: {
        valueSuffix: ' °F'
      }
    }]
  }));
}
*/

