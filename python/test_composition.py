"""Heterogeneous composition, order, canvas, cadence, silence and one result."""
import json,subprocess,tempfile,sys,hashlib
from pathlib import Path
import test_audio_gain as audio
import media_probe
from test_external_audio import amplitude

def pixel(path,time,x=160,y=90):
    result=subprocess.run([audio.FFMPEG,'-v','error','-ss',str(time),'-i',path,'-vf',f'crop=2:2:{x}:{y},format=rgb24','-frames:v','1','-f','rawvideo','-'],capture_output=True,check=True,timeout=30)
    return tuple(result.stdout[:3])

def run_composition(root, name, clips, fps):
    output=str(root/f'{name}.mp4')
    job={'id':-1,'kind':'composition','output_path':output,'encode_profile':'fast',
         'clips':clips,'canvas':{'width':320,'height':180,'fit':'contain'},'composition_fps':fps}
    manifest=root/f'{name}.json'
    manifest.write_text(json.dumps({'type':'beru-job-manifest','version':1,'jobs':[job]}))
    result=subprocess.run([sys.executable,str(audio.PROCESSOR),str(manifest)],capture_output=True,text=True,timeout=600)
    assert result.returncode==0,result.stdout+result.stderr
    return output,result.stdout+result.stderr

def run():
    with tempfile.TemporaryDirectory(prefix='beru-compose-') as directory:
        root=Path(directory);portrait=str(root/'portrait.mp4');landscape=str(root/'landscape.mp4')
        subprocess.run([audio.FFMPEG,'-v','error','-f','lavfi','-i','color=red:s=180x320:r=60:d=2','-c:v','libx264','-pix_fmt','yuv420p',portrait],check=True,timeout=30)
        subprocess.run([audio.FFMPEG,'-v','error','-f','lavfi','-i','color=blue:s=320x180:r=30:d=3','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=3','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-ac','2',landscape],check=True,timeout=30)
        def clip(path,fps):
            info=audio.probe(path)
            return {'input_path':path,'width':info['width'],'height':info['height'],'source_width':info['width'],'source_height':info['height'],'video_duration':info['duration'],'video_codec':info['video_codec'],'audio_codec':info['audio_codec'],'audio_channels':info['audio_channels'],'pix_fmt':'yuv420p','frame_rate':fps,'operations':[],'encode_profile':'fast'}
        clips=[clip(portrait,60),clip(landscape,30)]
        for fps,order in [(30,clips),(60,clips),(30,clips[::-1])]:
            name=f'composition-{fps}-'+('reverse' if order[0]['input_path']==landscape else 'forward')
            output,log=run_composition(root,name,order,fps)
            info=audio.probe(output);assert (info['width'],info['height'])==(320,180),info
            assert abs(info['duration']-5)<1/fps+.01,info
            assert info['audio_channels']==2,info
            streams=json.loads(subprocess.run([audio.FFPROBE,'-v','error','-show_streams','-of','json',output],capture_output=True,text=True,check=True).stdout)['streams']
            video=next(stream for stream in streams if stream['codec_type']=='video')
            assert video['r_frame_rate']==f'{fps}/1',video['r_frame_rate']
            assert video['sample_aspect_ratio']=='1:1'
            samples=audio.decode_mono(output)
            if order[0]['input_path']==portrait:
                assert pixel(output,1)[0]>180 and pixel(output,2.5)[2]>180
                assert max(pixel(output,1,5))<10, 'Contain must preserve portrait ratio with black bars'
                assert audio.rms(samples[int(.3*48000):int(1.7*48000)])<1e-4
                assert amplitude(samples,440,2.4,4.7)>1500
            else:
                assert pixel(output,1)[2]>180 and pixel(output,4)[0]>180
                assert amplitude(samples,440,.3,2.7)>1500
                assert audio.rms(samples[int(3.3*48000):int(4.7*48000)])<1e-4
            events=[json.loads(line) for line in log.splitlines() if line.startswith('{')]
            assert [event['index'] for event in events if event.get('type')=='complete']==[-1],events
        looped,log=audio.run_processor(root,portrait,'edited-entries',{'id':-1,'kind':'composition','clips':[{**clips[0],'trim_start':.5,'trim_end':1.5,'playback_rate':2,'repeat_count':3},clips[1]],'canvas':{'width':320,'height':180,'fit':'contain'},'composition_fps':30})
        assert abs(audio.probe(looped)['duration']-4.5)<.04
        events=[json.loads(line) for line in log.splitlines() if line.startswith('{')]
        assert [event['index'] for event in events if event.get('type')=='complete']==[-1]
        coded=str(root/'coded.mp4');rotated=str(root/'rotated.mp4')
        subprocess.run([audio.FFMPEG,'-v','error','-f','lavfi','-i','color=red:s=160x90:r=30:d=1','-c:v','libx264','-pix_fmt','yuv420p',coded],check=True,timeout=30)
        subprocess.run([audio.FFMPEG,'-v','error','-display_rotation:v:0','90','-i',coded,'-c','copy',rotated],check=True,timeout=30)
        rotated_info=media_probe.ffprobe(rotated,ffmpeg_bin=audio.FFMPEG,ffprobe_bin=audio.FFPROBE)
        assert (rotated_info['width'],rotated_info['height'])==(90,160), 'Fixture must carry display rotation'
        oriented,_=audio.run_processor(root,rotated,'oriented',{'id':-1,'kind':'composition','clips':[{**clip(rotated,30),'width':90,'height':160,'source_width':90,'source_height':160,'audio_muted':True},clips[1]],'canvas':{'width':320,'height':180,'fit':'contain'},'composition_fps':30})
        assert max(pixel(oriented,.4,5))<10, 'Metadata orientation must survive the edited intermediate'
        original_hash=hashlib.sha256(Path(landscape).read_bytes()).hexdigest()
        invalid=root/'overwrite-source.json';invalid.write_text(json.dumps({'type':'beru-job-manifest','version':1,'jobs':[{'id':-1,'kind':'composition','input_path':portrait,'output_path':landscape,'clips':clips,'canvas':{'width':320,'height':180,'fit':'contain'},'composition_fps':30}]}))
        rejected=subprocess.run([sys.executable,str(audio.PROCESSOR),str(invalid)],capture_output=True,text=True,timeout=30)
        assert rejected.returncode!=0
        assert Path(landscape).exists() and hashlib.sha256(Path(landscape).read_bytes()).hexdigest()==original_hash, 'A rejected output must not delete a later source'
        print('Composition: portrait60/no audio + landscape30/tone ->5s at30/60fps; order, silence and canvas passed')

if __name__=='__main__':run()
