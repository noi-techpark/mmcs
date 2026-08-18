https://github.com/noi-techpark/opendatahub-webcomponent-store/issues/232

Implement a mobility management control center.

Webapp that visualizes realtime mobility data and indicators.
Base UX on https://webcomponents.opendatahub.com/webcomponent/trains-realtime

Data feeds to aggregate:
- Siri VM
    - trains
    - buses
    - on demand buses

- Netex to display Lines, timetables etc. of the Siri vehicles

- Flights. Airport bolzano, show planned flights and their real-time status
    - planned from netex/gtfs
    - real-time unclear

- Taxis position from open data hub
- Parking from open data hub
- Bike Parking from open data hub
- Car sharing from open data hub
- E-Charging stations from open data hub

- traffic data from open data hub:
    - evaluate status based on thresholds per type of road
    - A22 travel times

- traffic incidents from open data hub (a22 + province bz)

- air quality index

- weather stations with status mapping on temperature and precipitatoin

- bike counters (thresholds for coloring tbd)


