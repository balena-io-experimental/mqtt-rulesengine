'use strict';

const
  _       = require('lodash'),
  debug   = require('debug')('mqtt-rebroadcast'),
  express = require('express'),
  app     = express(),
  server  = require('http').createServer(app),
  mqtt    = require('mqtt'),
  redis = require("redis")

// set vars from env
const
  mqttServer    = process.env.MQTT_SERVER,
  mqttTopic     = process.env.MQTT_TOPIC,
  redisUrl      = process.env.REDIS_URL,
  dashboardPort = process.env.PORT,
  republish     = !(process.env.DRY_RUN == 1)

// set up connections
const
  mqttClient  = mqtt.connect(mqttServer),
  redisClient = redis.createClient(redisUrl)

const handlers = {
  default: [
    (channel, room, message, topic) => {
      // Store raw data in redis and log it
      if (republish) {
        redisClient.rpush(topic, message)
      }
    },
  ],
  sensors: [
    // re-broadcast sensor data on a per-reading-type channel
    (channel, room, message, topic, id) => {
      const timestamp = (new Date()).getTime()
      const data = JSON.parse(message)

      if (data.apiVersion == "3.0.0") {
        if (id !== data.device.id) {
          console.error('device ID and published topic do not match!')
          console.error(topic, id, data)
          return
        }
        data.timestamp = timestamp

        publishToMqtt(channel, data.kind, data)
      } else {
        console.log('invalid apiVersion: ', topic, message)
      }
    }
  ],
  temperature: [
    (channel, room, message) => {
      const readings = []

      return (channel, room, message) => {
        const data = JSON.parse(message)
        readings.push(data.value)

        if (readings.length > 10) {
          readings.unshift()
        }
        console.log(readings)

        if (_.mean(readings) > 67.0) {
          return
        }

        publishToMqtt(channel, 'furnace', {
          type: 'bool',
          kind: 'action',
          value: true,
          device: {
            name: 'furnace1',
          },
          timestamp: (new Date()).getTime()
        }, 'furnace1')
      }
    }
  ]
}

const publishToMqtt = (channel, room, data, ...suffixes) => {
  const topic = _.join(_.flatten([channel, room, suffixes]), '/')
  const message = JSON.stringify(data)

  debug('   --> ', topic, message)
  if (!republish) {
    return
  }

  return mqttClient.publish(topic, message)
}

redisClient.on("error", (err) => {
  console.log("Error " + err)
})

mqttClient.on('connect', () => {
  mqttClient.subscribe(mqttTopic + '/#'),
  mqttClient.publish("Wxec0cXgwgC9KwBK", "mqtt rules engine/rebroadcast connected")
})

app.get('/', (req, res) => {
  res.render('./index.html')
})

app.get('/data/:room/:deviceId', (req, res) => {
  redisClient.lrange('Wxec0cXgwgC9KwBK/'+req.params.room, -1000, -1, (err, results) => {
    const data = _.map(_.filter(results, result => {
      return JSON.parse(result).device.id == req.params.deviceId
    }), result => {
      const obj = JSON.parse(result)

      return {
        x: obj.timestamp,
        y: obj.value
      }
    })

    res.status(200).send(JSON.stringify(data))
  })
})

mqttClient.on('message', (topic, message) => {
  // message is Buffer
  debug('<--    ', topic, message.toString())

  const [channel, room, ...rest]  = _.split(topic, '/')

  _.forEach(_.get(handlers, 'default', []), (handler) => {
    handler(channel, room, message.toString(), topic, ...rest)
  })
  _.forEach(_.get(handlers, room, []), (handler) => {
    handler(channel, room, message.toString(), topic, ...rest)
  })
})

server.listen(dashboardPort)

