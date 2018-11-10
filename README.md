
Hlsjs MediaInfo Module
======
Add-on module for [hls.js](https://github.com/video-dev/hls.js) to expose stream media info.  
Tested with hls.js v0.10.1, might not work with earlier versions.  

## Build
```bash
npm install          # install dev-dependences
npm install -g gulp  # install build tool
gulp release         # packaged & minimized js will be emitted in dist folder
```

## Usage
```html
<script src="hls.min.js"></script>
<script src="hlsjsMediaInfo.min.js"></script>
<video id="videoElement"></video>
<script>
    var hlsplayer = new Hls();
    hlsplayer.loadSource(...); // load your manifest here
    hlsplayer.attachMedia(document.querySelector('video'));
    HlsjsMediaInfoModule.observeMediaInfo(hlsplayer); // setup observer

    hlsplayer.mediaInfo // this will hold info of stream when available
</script>
```

## infos available
- Event `hlsMIStatPercentage`:  
Triggered with download progress `percentage`, value is between 0 to 1

- Property `downloadSpeed`:  
Fragments download speed, updated every second, in KB/s.  

- Property `mediaInfo`:  
Current playing quality stream info, see `Level info` for detail. 

- Property `mediaInfoLevels`:  
All parsed quality levels info, addition with a `current` property points to current downloading quality stream (This may not be the same as `mediaInfo`). 

- Level info
```
level
  |
  |---- level: id of this quality level
  |
  |---- bitrateMap: array holds correspoding bitrate for every second of muxed stream
  |
  |---- video/audio: shared properties
  |          |----- timeScale: stream timing scale
  |          |----- samples: AVLTree object of sample size
  |          |----- bitrateMap: bitrate map of this seperate stream
  |          |----- totalDuration: sum of parsed samples' duration
  |          |----- totalSize: sum of parsed samples' size
  |          |----- averageBitrate: average bitrate calculated from parsed samples
  |
  |---- video
  |       |----- videoCodec
  |       |----- width
  |       |----- height
  |       |----- fps
  |       |----- profile
  |       |----- level
  |       |----- chromaFormat
  |       |----- sarNum
  |       |----- sarDen
  |
  |---- audio
          |----- audioCodec
          |----- audioSampleRate
          |----- audioChannelCount
```