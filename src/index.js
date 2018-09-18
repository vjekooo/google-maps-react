import React from 'react';
import PropTypes from 'prop-types';
import ReactDOM from 'react-dom';
import { camelize } from './lib/String';
import { makeCancelable } from './lib/cancelablePromise';
import { log } from 'util';

const mapStyles = {
	container: {
		position: 'absolute',
		width: '100%',
		height: '100%'
	},
	map: {
		position: 'absolute',
		left: 0,
		right: 0,
		bottom: 0,
		top: 0
	}
};

const evtNames = [
	'ready',
	'click',
	'dragend',
	'recenter',
	'bounds_changed',
	'center_changed',
	'dblclick',
	'dragstart',
	'heading_change',
	'idle',
	'maptypeid_changed',
	'mousemove',
	'mouseout',
	'mouseover',
	'projection_changed',
	'resize',
	'rightclick',
	'tilesloaded',
	'tilt_changed',
	'zoom_changed'
];

let map, iw, actual, mark;
let overview, zIndex = 0;

export { wrapper as GoogleApiWrapper } from './GoogleApiComponent';
export { Marker } from './components/Marker';
export { InfoWindow } from './components/InfoWindow';
export { HeatMap } from './components/HeatMap';
export { Polygon } from './components/Polygon';
export { Polyline } from './components/Polyline';

export class Map extends React.Component {
	constructor(props) {
		super(props);

		if (!props.hasOwnProperty('google')) {
			throw new Error('You must include a `google` prop');
		}

		this.listeners = {}
		this.state = {
			currentLocation: {
				lat: this.props.initialCenter.lat,
				lng: this.props.initialCenter.lng
			},
			markers: [],
			currentMarker: null
		};
	}

	componentDidMount() {
		if (this.props.centerAroundCurrentLocation) {
			if (navigator && navigator.geolocation) {
				this.geoPromise = makeCancelable(
					new Promise((resolve, reject) => {
						navigator.geolocation.getCurrentPosition(resolve, reject);
					})
				);

				this.geoPromise.promise
					.then(pos => {
						const coords = pos.coords;
						this.setState({
							currentLocation: {
								lat: coords.latitude,
								lng: coords.longitude
							}
						});
					})
					.catch(e => e);
			}
		}
		this.loadMap();
	}

	componentDidUpdate(prevProps, prevState) {
		if (prevProps.google !== this.props.google) {
			this.loadMap();
		}
		if (this.props.visible !== prevProps.visible) {
			this.restyleMap();
		}
		if (this.props.zoom !== prevProps.zoom) {
			this.map.setZoom(this.props.zoom);
		}
		if (this.props.center !== prevProps.center) {
			this.setState({
				currentLocation: this.props.center
			});
		}
		if (prevState.currentLocation !== this.state.currentLocation) {
			this.recenterMap();
		}
		if (this.props.bounds !== prevProps.bounds) {
			this.map.fitBounds(this.props.bounds);
		}
		const markers = this.state.markers;
		markers.map(marker => {
			marker.setMap(map)
		});
		const infoWindow = document.querySelector('.infowindow');
		if (infoWindow) {
			infoWindow.onclick = () => {
				this.removePin(this.state.currentMarker)
			}
		}
	}

	componentWillUnmount() {
		const { google } = this.props;
		if (this.geoPromise) {
			this.geoPromise.cancel();
		}
		Object.keys(this.listeners).forEach(e => {
			google.maps.event.removeListener(this.listeners[e]);
		});
	}

	helper() {
		this.setMap(map);
		this.draw = function () { };
	}

	loadMap() {
		if (this.props && this.props.google) {
			const { google } = this.props;
			const maps = google.maps;

			const mapRef = this.refs.map;
			const node = ReactDOM.findDOMNode(mapRef);
			const curr = this.state.currentLocation;
			const center = new maps.LatLng(curr.lat, curr.lng);

			const mapTypeIds = this.props.google.maps.MapTypeId || {};
			const mapTypeFromProps = String(this.props.mapType).toUpperCase();

			const mapConfig = Object.assign(
				{},
				{
					mapTypeId: mapTypeIds[mapTypeFromProps],
					center: center,
					zoom: this.props.zoom,
					maxZoom: this.props.maxZoom,
					minZoom: this.props.minZoom,
					clickableIcons: !!this.props.clickableIcons,
					disableDefaultUI: this.props.disableDefaultUI,
					zoomControl: this.props.zoomControl,
					mapTypeControl: this.props.mapTypeControl,
					scaleControl: this.props.scaleControl,
					streetViewControl: this.props.streetViewControl,
					panControl: this.props.panControl,
					rotateControl: this.props.rotateControl,
					fullscreenControl: this.props.fullscreenControl,
					scrollwheel: this.props.scrollwheel,
					draggable: this.props.draggable,
					keyboardShortcuts: this.props.keyboardShortcuts,
					disableDoubleClickZoom: this.props.disableDoubleClickZoom,
					noClear: this.props.noClear,
					styles: this.props.styles,
					gestureHandling: this.props.gestureHandling
				}
			);

			Object.keys(mapConfig).forEach(key => {
				// Allow to configure mapConfig with 'false'
				if (mapConfig[key] === null) {
					delete mapConfig[key];
				}
			});

			this.map = new maps.Map(node, mapConfig);

			map = this.map;

			iw = new maps.InfoWindow();

			evtNames.forEach(e => {
				this.listeners[e] = this.map.addListener(e, this.handleEvent(e));
			});

			maps.event.trigger(this.map, 'ready');

			google.maps.event.addListener(map, 'click', function() {
			  if (iw) iw.close();
			});

			let pinArray = document.querySelectorAll('.drag');
			pinArray.forEach(pin => {
				pin.onmousedown = this.initDrag;
			});

			this.helper.prototype = new maps.OverlayView();
			overview = new this.helper();

			this.forceUpdate();
		}
	}

	handleEvent(evtName) {
		let timeout;
		const handlerName = `on${camelize(evtName)}`;

		return e => {
			if (timeout) {
				clearTimeout(timeout);
				timeout = null;
			}
			timeout = setTimeout(() => {
				if (this.props[handlerName]) {
					this.props[handlerName](this.props, this.map, e);
				}
			}, 0);
		};
	}

	recenterMap() {
		const map = this.map;

		const { google } = this.props;

		if (!google) return;
		const maps = google.maps;

		if (map) {
			let center = this.state.currentLocation;
			if (!(center instanceof google.maps.LatLng)) {
				center = new google.maps.LatLng(center.lat, center.lng);
			}
			// map.panTo(center)
			map.setCenter(center);
			maps.event.trigger(map, 'recenter');
		}
	}

	restyleMap() {
		if (this.map) {
			const { google } = this.props;
			google.maps.event.trigger(this.map, 'resize');
		}
	}

	fillMarker(icon) {
		var div = document.createElement('div');
		div.style.backgroundImage = 'url(' + icon + ')';
		var left;
		div.style.left = left;
		div.className = 'drag';
		div.onmousedown = () => {};
		// drag_area.replaceChild(div, mark);
		mark = null;
	}

	createDraggedMarker = (latlng, icon, category) => {
		var icon = {
			url: icon,
			size: new google.maps.Size(40, 50),
			anchor: new google.maps.Point(15, 32)
		};
		var marker = new google.maps.Marker({
			position: latlng,
			animation: google.maps.Animation.DROP,
			clickable: true,
			draggable: true,
			crossOnDrag: false,
			optimized: false,
			icon: icon,
			zIndex: zIndex,
			category: category
		});
		this.setState({
			markers: [
				...this.state.markers,
				marker
			]
		});
		google.maps.event.addListener(marker, 'click', () => {
			let contentStr = '<div class="infowindow">' + 'Kliknite na ovaj text za brisanje pina' + '<\/div>';
			iw.setContent(contentStr);
			iw.open(map, marker);
			this.setState({
				currentMarker: marker
			});
		});
		google.maps.event.addListener(marker, 'dragstart', () => {
			if (actual == marker) iw.close();
			zIndex += 1;
			marker.setZIndex(zIndex);
		});
		google.maps.event.addListener(marker, 'dragend', () => {
			this.updatePosition(marker);
		});
	}

	updatePosition = (marker) => {
		const index = this.state.markers.findIndex(item => item.closure_uid_458836287 === marker.closure_uid_458836287)
		const markers = [...this.state.markers]
		markers[index] = marker
		this.setState({
			markers: markers
		})
		
	}

	removePin = (marker) => {
		const index = this.state.markers.findIndex(item => item.closure_uid_458836287 === marker.closure_uid_458836287)
		const markers = [...this.state.markers]
		markers.splice(index, 1)
		this.setState({
			markers: markers
		});
		marker.setMap(null)
	}

	getPositions = () => {
		let iconWidth = mark.offsetWidth;
		let iconHeight = mark.offsetHeight;

		let newLeft = parseInt(mark.style.left) + iconWidth / 2;
		let newTop = parseInt(mark.style.top) - iconHeight;

		if (iconWidth) {
			let offset = 1;
			let divPt = new google.maps.Point(newLeft - offset, newTop);
			let proj = overview.getProjection();
			let latlng = proj.fromContainerPixelToLatLng(divPt);
			//let icon = mark.style.backgroundImage.slice(4, -1).replace(/"/g, '');
			let icon = mark.style.backgroundImage.slice(4, -6).replace(/"/g, '') + '-alt.svg';
			let category = mark.getAttribute('data-category');
			this.createDraggedMarker(latlng, icon, category);
			this.fillMarker(icon);
		}
	};

	initDrag = (evt) => {
		function getPt(evt) {
			var pt = {};
			if (evt && evt.touches && evt.touches.length) {
				pt.x = evt.touches[0].clientX;
				pt.y = evt.touches[0].clientY;
			} else {
				if (!evt) var evt = window.event;
				pt.x = evt.clientX;
				pt.y = evt.clientY;
			}
			return pt;
		};
		const drag = function (mEvt) {
			if (mark && mark.className == 'drag') {
				let pt = getPt(mEvt),
					x = pt.x - o.x,
					y = pt.y - o.y;
				mark.style.left = (mark.x + x) + 'px';
				mark.style.top = (mark.y + y) + 'px';
				mark.onmouseup = () => {
					console.log('aaaaa');
				}
			}
			return false;
		};
		if (!evt) var evt = window.event;
		mark = evt.target ? evt.target : evt.srcElement ? evt.srcElement : evt.touches ? evt.touches[0].target : null;
		if (mark.className != 'drag') {
			if (d.cancelable) d.preventDefault();
			mark = null;
			return;
		} else {
			zIndex++;
			mark.style.zIndex = zIndex.toString();
			mark.x = mark.offsetLeft;
			mark.y = mark.offsetTop;
			var o = getPt(evt);
			if (evt.type === 'touchstart') {
				mark.onmousedown = null;
				mark.ontouchmove = drag;
				mark.ontouchend = function () {
					mark.ontouchmove = null;
					mark.ontouchend = null;
					mark.ontouchstart = this.initDrag;
				};
			} else {
				document.onmousemove = drag;
				document.onmouseup = () => {
					this.getPositions();
					document.onmousemove = null;
					document.onmouseup = null;
					if (mark) mark = null;
				};
			}
		}
		return false;
	}

	renderChildren() {
		const { children } = this.props;
	
		if (!children) return;

		return React.Children.map(children, c => {
			if (!c) return;
			return React.cloneElement(c, {
				map: this.map,
				google: this.props.google,
				mapCenter: this.state.currentLocation
			});
		});
	}

	render() {
		const style = Object.assign({}, mapStyles.map, this.props.style, {
			display: this.props.visible ? 'inherit' : 'none'
		});

		const containerStyles = Object.assign(
			{},
			mapStyles.container,
			this.props.containerStyle
		);

		return (
			<div style={containerStyles} className={this.props.className}>
				<div style={style} ref="map">
					Loading map...
        		</div>
			</div>
		);
	}
}

Map.propTypes = {
	google: PropTypes.object,
	zoom: PropTypes.number,
	centerAroundCurrentLocation: PropTypes.bool,
	center: PropTypes.object,
	initialCenter: PropTypes.object,
	className: PropTypes.string,
	style: PropTypes.object,
	containerStyle: PropTypes.object,
	visible: PropTypes.bool,
	mapType: PropTypes.string,
	maxZoom: PropTypes.number,
	minZoom: PropTypes.number,
	clickableIcons: PropTypes.bool,
	disableDefaultUI: PropTypes.bool,
	zoomControl: PropTypes.bool,
	mapTypeControl: PropTypes.bool,
	scaleControl: PropTypes.bool,
	streetViewControl: PropTypes.bool,
	panControl: PropTypes.bool,
	rotateControl: PropTypes.bool,
	fullscreenControl: PropTypes.bool,
	scrollwheel: PropTypes.bool,
	draggable: PropTypes.bool,
	keyboardShortcuts: PropTypes.bool,
	disableDoubleClickZoom: PropTypes.bool,
	noClear: PropTypes.bool,
	styles: PropTypes.array,
	gestureHandling: PropTypes.string,
	bounds: PropTypes.object
};

evtNames.forEach(e => (Map.propTypes[camelize(e)] = PropTypes.func));

Map.defaultProps = {
	zoom: 14,
	initialCenter: {
		lat: 37.774929,
		lng: -122.419416
	},
	center: {},
	centerAroundCurrentLocation: false,
	style: {},
	containerStyle: {},
	visible: true
};

export default Map;
