#!/usr/bin/env bun

import { Entity, WorldService } from "@projectqai/proto/world";
import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";

const transport = createConnectTransport({ baseUrl: "http://localhost:50051" });
const client = createClient(WorldService, transport);

const BER_LAT = 52.3667;
const BER_LON = 13.5033;
const ALTITUDE = 50;
const OFFSET = 0.007;

const sensors: Entity[] = [
	{
		id: 'sensor1',
		geo: { latitude: BER_LAT + OFFSET, longitude: BER_LON - OFFSET, altitude: ALTITUDE },
		symbol: { milStd2525C: 'SFGPES----' },
	},
	{
		id: 'sensor2',
		geo: { latitude: BER_LAT + OFFSET, longitude: BER_LON + OFFSET, altitude: ALTITUDE },
		symbol: { milStd2525C: 'SFGPES----' },
	},
	{
		id: 'sensor3',
		geo: { latitude: BER_LAT - OFFSET, longitude: BER_LON + OFFSET, altitude: ALTITUDE },
		symbol: { milStd2525C: 'SFGPES----' },
	},
	{
		id: 'sensor4',
		geo: { latitude: BER_LAT - OFFSET, longitude: BER_LON - OFFSET, altitude: ALTITUDE },
		symbol: { milStd2525C: 'SFGPES----' },
	},
];

const bird: Entity = {
	id: 'bird',
	label: "Birdy",
	geo: { latitude: BER_LAT, longitude: BER_LON, altitude: ALTITUDE + 100 },
	symbol: { milStd2525C: 'SHAPMFQ----' },
	bearing: { azimuth: 180, elevation: 0 },
	track: {},
};

const camera: Entity = {
	id: 'camera',
	geo: { latitude: BER_LAT, longitude: BER_LON + 0.01, altitude: ALTITUDE + 100 },
	symbol: { milStd2525C: 'SFGPE-----' },
	bearing: { azimuth: 180, elevation: 0 },
}

const task: Entity = {
	id: 'camera-look-at-something',
	label: "View with Camera",
	taskable: {
		context: [{
			entityId: "bird",
		}],
		assignee: [{
			entityId: "camera",
		}],
	}
}

const response = await client.push({ changes: [sensors[0], sensors[1], sensors[2], sensors[3], bird, camera, task] });
if (!response.accepted) {
	throw new Error(`Failed to push ${bird.id}: ${response.response.debug}`);
}
