// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for full license information.

'use strict';

const deviceId = "<DeviceId>";
var deviceConnectionString = "<DeviceConnectionString>";

// Choose a protocol by uncommenting one of these transports.
var Protocol = require('azure-iot-device-mqtt').Mqtt;
// var Protocol = require('azure-iot-device-amqp').Amqp;
// var Protocol = require('azure-iot-device-http').Http;
// var Protocol = require('azure-iot-device-mqtt').MqttWs;
// var Protocol = require('azure-iot-device-amqp').AmqpWs;

var Client = require('azure-iot-device').Client;
const Message = require('azure-iot-device').Message;
var player = require('play-sound')()
var audio = null;

//Default variables
var minWatertemperature = 80;
var maxWatertemperature = 100;
var state = "Not Brewing";
var brewingTimer = 0;
var waterLevel = 51;

let sendInterval;

var cloudMessageHandlerRegistered = false;

// create the IoTHub client
var client = Client.fromConnectionString(deviceConnectionString, Protocol);
console.log('Client created');

client.on('connect', connectHandler);
client.on('disconnect', disconnectHandler);
    
// Register Direct methods
client.onDeviceMethod('StartBrewing', onCommandStartBrewing);
client.onDeviceMethod('ResetWaterLevel', onCommandResetWaterLevel);

// Connect to the hub
client.open(function(err) {
  if (err) {
    console.error('could not open IotHub client');
  }  else {
    console.log('Client opened');   

    console.log("---------------------------------------");
    console.log(" Copyrights 2022 Alten");
    console.log("---------------------------------------");
    console.log("Supported desired properties:");
    console.log("- Watertemperature.min: " + minWatertemperature);
    console.log("- Watertemperature.max: " + maxWatertemperature);
    console.log("Supported direct methods:");
    console.log("- StartBrewing ");    
    console.log("- ResetWaterLevel");    
    console.log("---------------------------------------");
    
    // Create device Twin
    client.getTwin(function(err, twin) {
      if (err) {
        console.error('could not get twin');
      } else {
        console.log('Twin created');

        twin.on('properties.desired', function(delta) {
            console.log('new desired properties received:');
            console.log(JSON.stringify(delta));
        });

        // React on incoming twin
        twin.on('properties.desired.Watertemperature', function(delta) { 
          if (delta.min || delta.max) {
            console.log('updating desired Watertemperature:');
            minWatertemperature = (twin.properties.desired.Watertemperature.min == null) ? minWatertemperature : twin.properties.desired.Watertemperature.min;
            maxWatertemperature = (twin.properties.desired.Watertemperature.max == null) ? maxWatertemperature : twin.properties.desired.Watertemperature.max;

            console.log('Desired min temp = ' + minWatertemperature);
            console.log('Desired max temp = ' + maxWatertemperature);
          }

          // Create reported property patch to send to the hub
          var patch = {
            Watertemperature:{ min: minWatertemperature, max: maxWatertemperature, wl: waterLevel }
          };

          // Send the patch to update reported properties
          twin.properties.reported.update(patch, function(err) {
            if (err) throw err;
            console.log('twin state reported:' + JSON.stringify(patch));
          });

          
        }); 
      }
    });

    // Register for Cloud Messages based on correct twin
    if (!cloudMessageHandlerRegistered) {
      client.on('message', messageHandler);
      cloudMessageHandlerRegistered = true;
      console.log('Cloud message handler registered');
    }

  }
});

//-----------------------------------
// Functions for receiving Cloud messages
//-----------------------------------
function messageHandler (msg) {
  console.log('Cloud message received');
  console.log('Id: ' + msg.messageId + ' Body: ' + msg.data);
  client.complete(msg);
}

//-----------------------------------
// Functions for connect/disconnect
//-----------------------------------
function disconnectHandler () {
  clearInterval(sendInterval);
  sendInterval = null;
  client.open().catch((err) => {
    console.error(err.message);
  });
}

function connectHandler () {
  console.log('Client connected');
  // Create a message and send it to the IoT Hub every two seconds
  if (!sendInterval) {
    sendInterval = setInterval(() => {
      const message = generateMessage();
      console.log('Sending message: ' + message.getData());
      client.sendEvent(message);

      // Brewing timer
      if (brewingTimer > 0)
      {
        if (waterLevel - brewingTimer > 0) {
          brewingTimer--;

          waterLevel--;

          // Finished brewing
          if (brewingTimer == 0)
          {
            state = 'Not Brewing';
            stopCoffeeSound();
          } else {
            state = 'Brewing';
            startCoffeeSound();
          }
        } else {
          state = 'Waterlevel too low!';
        }
      }
    }, 2000);
  }
}

//-----------------------------------
// Function for sending message
//-----------------------------------
function generateMessage () {
  const temperature =  Math.random() * (maxWatertemperature - minWatertemperature) + minWatertemperature

  const data = JSON.stringify({ 
      DeviceId: deviceId,       	
		  Timestamp: new Date().toISOString(),
      State: state,
      WaterTemperature: temperature, 
      WaterLevel: waterLevel
  });

  const message = new Message(data);
  message.contentType = 'application/json';
  message.contentEncoding = 'utf-8';
  message.properties.add('waterLevelAlert', (waterLevel - brewingTimer <= 0) ? 'true' : 'false');
  return message;
}

//-----------------------------------
// Functions for Direct methods 
//-----------------------------------
function onCommandStartBrewing(request, response) 
{
  console.log(' * Brewing command received');

  // Console warning
  if (state != 'Not Brewing') {
    console.log(' - Warning: The device is already brewing.');
  }
  else {
    brewingTimer = 20;
    state = "Pressurize water";
  }

  // Respond
  response.send(200, 'Success', function (errorMessage) 
  {
      // Failure
      if (errorMessage) 
      {
          console.error('[IoT hub Client] Failed sending a method response:\n' + errorMessage.message);
      }
  });
}


function onCommandResetWaterLevel(request, response) 
{
  console.log(' * Reset water level received');

  waterLevel = Math.round((Math.random() * 5) + 48);
  state = 'Not Brewing';
  stopCoffeeSound();

  console.log(' * Reset to ' + waterLevel + '; state set to ' + state);

  // Respond
  response.send(200, 'Success', function (errorMessage) 
  {
      // Failure
      if (errorMessage) 
      {
          console.error('[IoT hub Client] Failed sending a method response:\n' + errorMessage.message);
      }
  });
}

function startCoffeeSound()
{
  if (!audio) {
    audio = player.play('coffee-brewing.mp3', function(err){
      if (err) throw err
    })
  }
}

function stopCoffeeSound()
{
  if (audio) {
    audio.kill()
    audio = null;
  }
}