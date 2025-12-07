#!/usr/bin/env bun

import { credentials } from '@grpc/grpc-js';
import { GrpcTransport } from '@protobuf-ts/grpc-transport';
import { WorldServiceClient } from './generated/world.client';

// Berlin Brandenburg Airport (BER) coordinates
const BER_LAT = 52.3667;
const BER_LON = 13.5033;
const ALTITUDE = 50; // meters above sea level

// Create a square around BER airport (approximately 1km on each side)
const OFFSET = 0.007; // roughly 1km in degrees

const sensors = [
  {
    id: 'sensor1',
    lat: BER_LAT + OFFSET,
    lon: BER_LON - OFFSET,
  },
  {
    id: 'sensor2',
    lat: BER_LAT + OFFSET,
    lon: BER_LON + OFFSET,
  },
  {
    id: 'sensor3',
    lat: BER_LAT - OFFSET,
    lon: BER_LON + OFFSET,
  },
  {
    id: 'sensor4',
    lat: BER_LAT - OFFSET,
    lon: BER_LON - OFFSET,
  },
];

const drone = {
  id: 'drone',
  lat: BER_LAT,
  lon: BER_LON,
};

async function pushEntities() {
  // Create gRPC transport
  const transport = new GrpcTransport({
    host: 'localhost:50051',
    channelCredentials: credentials.createInsecure(),
  });

  // Create client
  const client = new WorldServiceClient(transport);

  console.log('Pushing sensor entities...');

  // Push sensor entities
  for (const sensor of sensors) {
    const entity = {
      id: sensor.id,
      geo: {
        latitude: sensor.lat,
        longitude: sensor.lon,
        altitude: ALTITUDE,
      },
      symbol: {
        milStd2525C: 'SFGPES----', // Ground sensor symbol
      },
    };

    console.log(`\nSending entity:`, JSON.stringify(entity, null, 2));

    try {
      const response = await client.push({
        changes: [entity],
      });

      console.log(`Response:`, JSON.stringify(response.response, null, 2));

      if (response.response.accepted) {
        console.log(`✓ Successfully pushed ${sensor.id}`);
      } else {
        console.log(`✗ Failed to push ${sensor.id}: ${response.response.debug}`);
      }
    } catch (error) {
      console.error(`Error pushing ${sensor.id}:`, error);
    }
  }

  console.log('\nPushing drone entity...');

  // Push drone entity
  const droneEntity = {
    id: drone.id,
    geo: {
      latitude: drone.lat,
      longitude: drone.lon,
      altitude: ALTITUDE + 100, // Drone at 150m
    },
    symbol: {
      milStd2525C: 'SHAPMFQ----',
    },
    bearing: {
      azimuth: 180, // Pointing south (180 degrees)
      elevation: 0,
    },
	track: {},
  };

  console.log(`\nSending entity:`, JSON.stringify(droneEntity, null, 2));

  try {
    const response = await client.push({
      changes: [droneEntity],
    });

    console.log(`Response:`, JSON.stringify(response.response, null, 2));

    if (response.response.accepted) {
      console.log(`✓ Successfully pushed ${drone.id}`);
    } else {
      console.log(`✗ Failed to push ${drone.id}: ${response.response.debug}`);
    }
  } catch (error) {
    console.error(`Error pushing ${drone.id}:`, error);
  }

  console.log('\n--- Verifying entities with ListEntities ---');

  try {
    const listResponse = await client.listEntities({});
    console.log(`\nFound ${listResponse.response.entities.length} entities:`);
    for (const entity of listResponse.response.entities) {
      console.log(`- ${entity.id} at (${entity.geo?.latitude}, ${entity.geo?.longitude}, ${entity.geo?.altitude}m)`);
    }
  } catch (error) {
    console.error('Error listing entities:', error);
  }

  console.log('\nDone! All entities pushed.');

  // Close transport
  transport.close();
}

pushEntities().catch(console.error);
