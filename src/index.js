var quickLoader = require('quick-loader');
var dat = require('dat-gui');
var Stats = require('stats.js');
var css = require('dom-css');
var raf = require('raf');

var THREE = require('three');
var leap = require('./libs/leapjs/index');
var settings = require('./leap/settings');
var Hand = require('./leap/Hand');
var ground = require('./leap/ground');
var lights = require('./leap/lights');
var particles = require('./leap/particles');
var defaultHandData = require('./leap/defaultHandData');
var gripHandData = require('./leap/gripHandData');

var OrbitControls = require('./controls/OrbitControls');

var WAGNER = require('@superguigui/wagner');
var BloomPass = require('@superguigui/wagner/src/passes/bloom/MultiPassBloomPass');
var VignettePass = require('@superguigui/wagner/src/passes/vignette/VignettePass');

var mobile = require('./fallback/mobile');

var undef;
var _gui;
var _stats;

var _width = 0;
var _height = 0;

var _control;
var _camera;
var _scene;
var _renderer;

var _hand;
var _bloomPass;
var _vignettePass;

var _composer;
var _passes = [];

var _time = 0;
var _initAnimation = 0;
var _initZoomAnimation = 0;
var _gripRatio = 0;

var _logo;
var _footerItems;

var _ray = new THREE.Ray();
var _isLog = false;
var _isDown = false;
var _hasLeapUpdated = false;
var _hasLeap = undef;
var _prevHandData = undef;

function init() {

    if(settings.useStats) {
        _stats = new Stats();
        css(_stats.domElement, {
            position : 'absolute',
            left : '0px',
            top : '0px',
            zIndex : 2048
        });

        document.body.appendChild( _stats.domElement );
    }

    _renderer = new THREE.WebGLRenderer({

    });
    _renderer.setClearColor(0xCCCCCC);
    // _renderer.shadowMap.type = THREE.BasicShadowMap;
    _renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    _renderer.shadowMap.enabled = true;
    document.body.appendChild(_renderer.domElement);

    _scene = new THREE.Scene();
    _scene.fog = new THREE.FogExp2( 0xCCCCCC, 0.001 );

    _camera = new THREE.PerspectiveCamera( 45, 1, 1, 3000);
    _camera.position.set(0, 3000, 5000);

    _control = new OrbitControls( _camera, _renderer.domElement );
    _control.noPan = true;
    _control.minDistance = 250;
    _control.minPolarAngle = 0.3;
    _control.maxPolarAngle = Math.PI / 2;
    _control.target.y = 100;
    _control.update();

    settings.mouse = new THREE.Vector2(0,0);
    settings.mouse3d = _ray.origin;

    lights.init();
    _scene.add(lights.mesh);

    _hand = new Hand();
    _scene.add(_hand);

    ground.init();
    _scene.add(ground.mesh);

    particles.init(_renderer, _hand);
    _scene.add(particles.mesh);


    _composer = new WAGNER.Composer( _renderer );

    _bloomPass = new BloomPass({
        blurAmount: 1,
        applyZoomBlur: true,
        zoomBlurStrength: 0.5
    });
    _passes.push(_bloomPass);

    _vignettePass = new VignettePass(1, 0.3);
    _vignettePass.isActive = true;

    _passes.push(_vignettePass);

    _gui = new dat.GUI();

    var particlesGui = _gui.addFolder('particles');
    particlesGui.add(settings, 'gravity', -5, 20);
    particlesGui.add(settings, 'particlesFromY', 0, 500).name('from Y');
    particlesGui.add(settings, 'particlesYDynamicRange', -500, 500).name('y dynamic range');

    particlesGui.add(settings, 'particlesDropRadius', 0, 150).name('drop radius');
    particlesGui.add(settings, 'handBounceRatio', 0, 1).name('hand bounce');
    particlesGui.add(settings, 'handForce', 0, 0.1).name('hand force');

    var shadowGui = _gui.addFolder('environment');
    // shadowGui.add(settings, 'lightSpeed', 0, 1);
    shadowGui.add(settings, 'shadowDarkness', 0.1, 0.8);

    var ppGui = _gui.addFolder('post-processing');
    ppGui.add(settings, 'bloomOpacity', 0, 1).name('bloom');
    ppGui.add(_vignettePass, 'isActive').name('vignette');

    // if(window.innerWidth > 512) {
    //     particlesGui.open();
    //     shadowGui.open();
    //     ppGui.open();
    // }

    _logo = document.querySelector('.logo');
    _footerItems = document.querySelectorAll('.footer span');

    _gui.domElement.addEventListener('mousedown', _stopPropagation);
    _gui.domElement.addEventListener('touchstart', _stopPropagation);

    window.addEventListener('click', _onClick);
    window.addEventListener('mousedown', _onDown);
    window.addEventListener('touchstart', _bindTouch(_onDown));
    window.addEventListener('mousemove', _onMove);
    window.addEventListener('touchmove', _bindTouch(_onMove));
    window.addEventListener('mouseup', _onUp);
    window.addEventListener('touchend', _bindTouch(_onUp));
    window.addEventListener('resize', _onResize);

    var defaultHand = _createInpterpolatedHandData(defaultHandData, gripHandData, {});
    defaultHand.pitch = function(){return this._pitch;};
    defaultHand.yaw = function(){return this._yaw;};
    defaultHand.roll = function(){return this._roll;};
    _onLeapUpdate({hands: [defaultHand]}, true);
    leap.loop(_onLeapUpdate);

    _time = Date.now();
    _onResize();
    _loop();

}

function _createInpterpolatedHandData(data0, data1, target) {
    var val0, val1;
    for(var prop in data0) {
        if(_hasOwn(data0, prop)) {
            val0 = data0[prop];
            val1 = data1[prop];
            if(typeof val0 === 'object') {
                target[prop] = _createInpterpolatedHandData(val0, val1, val0.length ? [] : {});
            } else if(!isNaN(val0)) {
                Object.defineProperty(target, prop, { get: _getLerpHandData.bind(null, data0, data1, prop) });
            }
        }
    }
    return target;
}

function _getLerpHandData(data0, data1, prop) {
    var a = data0[prop];
    var b = data1[prop];
    return a + (b - a) * _gripRatio;
}

function _hasOwn(obj, prop){
    return Object.prototype.hasOwnProperty.call(obj, prop);
}

function _onClick() {
    _isLog = true;
}

function _stopPropagation(evt) {
    evt.stopPropagation();
}

function _bindTouch(func) {
    return function (evt) {
        func(evt.changedTouches[0]);
    };
}

function _onDown() {
    _isDown = true;
}

function _onMove(evt) {
    settings.mouse.x = (evt.pageX / _width) * 2 - 1;
    settings.mouse.y = -(evt.pageY / _height) * 2 + 1;
}

function _onUp() {
    _isDown = false;
}

function _onLeapUpdate(frame, isDefaultData) {

    if(!isDefaultData && !_hasLeap) {
        _hasLeap = true;
    }
    if (frame.hands && frame.hands.length) {

        _prevHandData = frame.hands[0];

        _hasLeapUpdated = true;

        if(_isLog) {
            _isLog = false;
            var hand = frame.hands[0];

            // Record default hand data

            // var handData = {};
            // var fingers = handData.fingers = [];
            // var data;
            // for(var i = 0; i < 5; i++) {
            //     data = fingers[i] = {};
            //     data.positions = hand.fingers[i].positions;
            //     data.width = hand.fingers[i].width;
            // }
            // handData.palmPosition = hand.palmPosition;
            // handData.palmVelocity = hand.palmVelocity;
            // handData._pitch = hand.pitch();
            // handData._yaw = hand.yaw();
            // handData._roll = hand.roll();
            // handData.pinky = {positions : [0, hand.pinky.positions[1]]};
            // handData.thumb = {positions : [0, hand.thumb.positions[1]], width : hand.thumb.width};
            // handData.palmPosition = hand.palmPosition;
            // console.log(JSON.stringify(handData, true, '    '));


            // Record static data for shadertoy test.

            // var count = 0;
            // var res = _hand.updateOutputMatrix();
            // var output = JSON.stringify(res, true, '    ');
            // output = output.replace(/,\s\s\s\s\s\s\s\s/gm, ',');
            // output = output.replace(/\[\s\s\s\s\s\s\s\s/gm, function(){
            //     return 'data[' + (count++) +  '] = mat4(';
            // });
            // output = output.replace(/,\s1\s\s\s\s\s\]/gm, ', 1.0);');
            // output = output.replace(/,\s0,/gm, ', 0.0,');
            // output = output.replace(/;,/gm, ';');
            // output = output.replace(/\s\s\s\s\s\],/gm, ');');
            // output = output.replace(/\s\s\s\s\s\]/gm, ');');
            // console.log(output);
        }
    }
}





function _onResize() {
    _width = window.innerWidth;
    _height = window.innerHeight;

    _composer.setSize( _width, _height);

    _camera.aspect = _width / _height;
    _camera.updateProjectionMatrix();
    _renderer.setSize(_width, _height);

}

function _loop() {
    var newTime = Date.now();
    raf(_loop);
    if(settings.useStats) _stats.begin();
    _render(newTime - _time);
    if(settings.useStats) _stats.end();
    _time = newTime;
}

function _lerp(min, max, ratio) {
    return min + (max - min) * ratio;
}

function _clamp(value, min, max) {
    return value > max ? max : value < min ? min : value;
}

function _range(min, max, val) {
    return _clamp((val - min) / (max - min), 0, 1);
}

function _render(dt) {

    _initAnimation = Math.min(_initAnimation + dt * 0.0002, 1);
    _initZoomAnimation = Math.min(_initZoomAnimation + dt * 0.0001, 1);

    var easedInitAnimation = Math.pow(_initAnimation, 0.3);
    var easedInitZoomAnimation = Math.pow(_initZoomAnimation, 0.3);

    _control.maxDistance = _initZoomAnimation === 1 ? 1200 : _lerp(1400, 500, easedInitZoomAnimation);
    _control.update();

    // update mouse3d
    _camera.updateMatrixWorld();
    _ray.origin.setFromMatrixPosition( _camera.matrixWorld );
    _ray.direction.set( settings.mouse.x, settings.mouse.y, 0.5 ).unproject( _camera ).sub( _ray.origin ).normalize();
    var distance = _ray.origin.length() / Math.cos(Math.PI - _ray.direction.angleTo(_ray.origin));
    _ray.origin.add( _ray.direction.multiplyScalar(distance));

    if(_hasLeap === undef) {
        _gripRatio += ((_isDown ? 1 : 0) - _gripRatio) * 0.01 * dt;
        defaultHandData.palmVelocity[0] = gripHandData.palmVelocity[0] = (_ray.origin.x - _hand.position.x) * 20;
        defaultHandData.palmVelocity[1] = gripHandData.palmVelocity[1] = (_ray.origin.y - _hand.position.y) * 20;
        defaultHandData.palmVelocity[2] = gripHandData.palmVelocity[2] = (_ray.origin.z - _hand.position.z) * 20;
        _hand.position.copy(_ray.origin);

    } else {
        if(!_hasLeapUpdated) {
            defaultHandData.palmVelocity[0] = defaultHandData.palmVelocity[1] = defaultHandData.palmVelocity[2] = 0;
        }
        _hand.position.x -= _hand.position.x * 0.05;
        _hand.position.y -= _hand.position.y * 0.05;
        _hand.position.z -= _hand.position.z * 0.05;
    }

    _hand.leapUpdate(_prevHandData);

    particles.update(dt);
    lights.update(dt, _camera);

    var ratio = Math.min((1 - Math.abs(_initZoomAnimation - 0.5) * 2) * 1.2, 1);
    var blur = (1 - ratio) * 10;
    _logo.style.opacity = ratio;
    _logo.style.display = ratio ? 'block' : 'none';
    _logo.style.webkitFilter = 'blur(' + blur + 'px)';

    ratio = (0.8 + Math.pow(_initAnimation, 1.5) * 0.3);
    if(_width < 580) ratio *= 0.5;
    _logo.style.transform = 'scale3d(' + ratio + ',' + ratio + ',1)';

    for(var i = 0, len = _footerItems.length; i < len; i++) {
        ratio = _range(0.5 + i * 0.01, 0.6 + i * 0.01, _initAnimation);
        _footerItems[i].style.transform = 'translate3d(0,' + ((1 - Math.pow(ratio, 3)) * 50) + 'px,0)';
    }

    _vignettePass.params.boost = _lerp(1.1, 1, easedInitAnimation);
    _vignettePass.params.reduction = _lerp(-0.1, 0.4, easedInitAnimation);

    _bloomPass.blendPass.params.opacity =  _lerp(1, settings.bloomOpacity, easedInitAnimation);
    _bloomPass.isActive = !!_bloomPass.blendPass.params.opacity;

    lights.pointLight.shadowDarkness = settings.shadowDarkness;


    var useComposer = false;
    for( i = 0, len = _passes.length; i < len; i++) {
        if(_passes[i].isActive) {
            useComposer = true;
            break;
        }
    }

    _renderer.autoClearColor = true;

    if(useComposer) {
        _composer.reset();
        _composer.render(_scene, _camera);

        for(i = 0, len = _passes.length; i < len; i++) {
            if(_passes[i].isActive) _composer.pass(_passes[i]);
            _composer.toScreen();
        }
    } else {
        _renderer.render(_scene, _camera);
    }

    _hasLeapUpdated = false;

}



mobile.pass(function() {
    var img = new Image();
    img.src = 'images/logo.png';
    if(img.width) {
        init();
    } else {
        img.onload = init;
    }
});
