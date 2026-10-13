"""Measured duration, source effect windows and pitch through the real CLI."""
import subprocess, tempfile, json
from pathlib import Path
import test_audio_gain as audio
from test_external_audio import amplitude

def pixel(path,time):
    result=subprocess.run([audio.FFMPEG,'-v','error','-ss',str(time),'-i',path,'-vf','crop=2:2:30:30,format=rgb24','-frames:v','1','-f','rawvideo','-'],capture_output=True,check=True,timeout=30)
    return tuple(result.stdout[:3])

def run():
    with tempfile.TemporaryDirectory(prefix='beru-retime-') as directory:
        root=Path(directory);source=audio.make_source(root,'source.mp4',True)
        fast,_=audio.run_processor(root,source,'fast',{'playback_rate':2})
        assert abs(audio.probe(fast)['duration']-2)<.06,audio.probe(fast)
        samples=audio.decode_mono(fast)
        assert amplitude(samples,440,.3,1.5)>1500
        assert amplitude(samples,880,.3,1.5)<30, 'Pitch must stay at 440Hz'
        slow,_=audio.run_processor(root,source,'slow',{'playback_rate':.5})
        assert abs(audio.probe(slow)['duration']-8)<.06,audio.probe(slow)
        assert amplitude(audio.decode_mono(slow),440,1,6)>1500
        effect={'mode':'delogo','delogo_method':'fill','delogo_fill_color':'red','delogo_fill_opacity':1,'region':{'x':20,'y':20,'w':60,'h':60},'start_time':1.5,'end_time':2.5}
        window,_=audio.run_processor(root,source,'window',{'trim_start':1,'trim_end':3,'playback_rate':2,'operations':[effect]})
        assert abs(audio.probe(window)['duration']-1)<.06
        inside=pixel(window,.5);outside=pixel(window,.1)
        assert inside[0]>180 and inside[1]<80,(inside,outside)
        assert outside[0]<80,outside
        music=str(root/'music.wav')
        subprocess.run([audio.FFMPEG,'-v','error','-f','lavfi','-i','sine=frequency=880:sample_rate=48000:duration=0.3',music],check=True,timeout=30)
        repeated,log=audio.run_processor(root,source,'repeat',{'trim_start':1,'trim_end':3,'playback_rate':2,'repeat_count':3,'operations':[effect],
            'external_audio':{'path':music,'mode':'mix','offset':.4},'asset_roots':[str(root)]})
        assert abs(audio.probe(repeated)['duration']-3)<.06,audio.probe(repeated)
        samples=audio.decode_mono(repeated)
        for cycle in range(3):
            assert pixel(repeated,cycle+.5)[0]>180
            assert pixel(repeated,cycle+.1)[0]<80
            assert amplitude(samples,440,cycle+.2,cycle+.8)>500
            assert amplitude(samples,880,cycle+.45,cycle+.65)>500
            assert amplitude(samples,880,cycle+.1,cycle+.3)<30
        events=[json.loads(line) for line in log.splitlines() if line.startswith('{')]
        assert sum(event.get('type')=='complete' for event in events)==1,events
        progress=[event['percent'] for event in events if event.get('type')=='job_progress']
        assert progress==sorted(progress),progress
        assert progress[-1]==100,progress
        assert not list(root.glob('beru-loop-*'))
        legacy_muted,_=audio.run_processor(root,source,'legacy-muted',{'playback_rate':2,'audio_muted':True,'video_info_probed':True,'audio_codec':'','audio_channels':0})
        assert audio.rms(audio.decode_mono(legacy_muted))<1e-4, 'Retime must apply restored mute using the real track'
        legacy_repeat,_=audio.run_processor(root,source,'legacy-repeat-muted',{'repeat_count':3,'audio_muted':True,'video_info_probed':True,'audio_codec':'','audio_channels':0})
        assert audio.rms(audio.decode_mono(legacy_repeat))<1e-4, 'Repeated identity cycle must also apply restored mute'
        short_music=str(root/'short.wav')
        subprocess.run([audio.FFMPEG,'-v','error','-f','lavfi','-i','sine=frequency=880:sample_rate=48000:duration=0.12',short_music],check=True,timeout=30)
        fractional,_=audio.run_processor(root,source,'fractional',{'trim_start':1,'trim_end':3.03,'playback_rate':1.5,'repeat_count':20,
            'operations':[{**effect,'start_time':1.6,'end_time':1.9}],
            'external_audio':{'path':short_music,'mode':'mix','offset':.12},'asset_roots':[str(root)]})
        cycle_duration=2.03/1.5
        assert abs(audio.probe(fractional)['duration']-cycle_duration*20)<.04
        samples=audio.decode_mono(fractional)
        for cycle in [0,9,19]:
            assert pixel(fractional,cycle*cycle_duration+.5)[0]>180,cycle
            assert amplitude(samples,880,cycle*cycle_duration+.14,cycle*cycle_duration+.2)>500,cycle
        vfr=str(root/'vfr.mp4')
        subprocess.run([audio.FFMPEG,'-v','error','-i',source,'-vf',"select='if(lt(t,2),not(mod(n,2)),1)'",'-fps_mode','vfr','-c:v','libx264','-c:a','copy',vfr],check=True,timeout=30)
        retimed_vfr,_=audio.run_processor(root,vfr,'vfr-fast',{'playback_rate':2})
        def timestamps(path):
            frames=json.loads(subprocess.run([audio.FFPROBE,'-v','error','-select_streams','v:0','-show_frames','-show_entries','frame=best_effort_timestamp_time','-of','json',path],capture_output=True,text=True,check=True,timeout=30).stdout)['frames']
            return [float(frame['best_effort_timestamp_time']) for frame in frames]
        original_times=timestamps(vfr);output_times=timestamps(retimed_vfr)
        deltas=lambda times:[b-a for a,b in zip(times,times[1:])]
        assert max(deltas(original_times))-min(deltas(original_times))>.02, 'Fixture must actually be VFR'
        assert max(deltas(output_times))-min(deltas(output_times))<.001, 'Retime uses CFR at average source FPS'
        assert abs(audio.probe(retimed_vfr)['duration']-2)<.06
        assert amplitude(audio.decode_mono(retimed_vfr),440,.3,1.5)>1500
        silent=audio.make_source(root,'silent.mp4',False)
        repeated_silent,_=audio.run_processor(root,silent,'silent-repeat',{'playback_rate':2,'repeat_count':3})
        assert audio.probe(repeated_silent)['audio_channels']==0
        assert abs(audio.probe(repeated_silent)['duration']-6)<.06
        print('Video timing: 2x/0.5x duration, original pitch and source effect window passed')

if __name__=='__main__':run()
