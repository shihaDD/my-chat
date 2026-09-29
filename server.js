mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) audioChunks.push(e.data);
            };

            mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                const reader = new FileReader();
                reader.readAsDataURL(audioBlob);
                reader.onloadend = async () => {
                    const base64Audio = reader.result;
                    if (isRecordingAudio) {
                        await sendMediaMessage(base64Audio, 'audio');
                    }
                };
            };

            mediaRecorder.start();
            isRecordingAudio = true;
            recordSeconds = 0;
            document.getElementById('voiceRecordBox').classList.remove('hidden');
            
            recordTimerInterval = setInterval(() => {
                recordSeconds++;
                const mins = String(Math.floor(recordSeconds / 60)).padStart(2, '0');
                const secs = String(recordSeconds % 60).padStart(2, '0');
                document.getElementById('voiceTimer').textContent = `${mins}:${secs}`;
            }, 1000);
        } catch (err) {
            showNeonAlert('Ошибка', 'Не удалось получить доступ к микрофону!');
        }
    }

    function stopVoiceRecording(shouldSend) {
        if (!mediaRecorder || mediaRecorder.state === 'inactive') return;
        isRecordingAudio = shouldSend;
        mediaRecorder.stop();
        mediaRecorder.stream.getTracks().forEach(track => track.stop());
        clearInterval(recordTimerInterval);
        document.getElementById('voiceRecordBox').classList.add('hidden');
    }

    function handleFileSelected(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        const fileType = file.type.startsWith('image/') ? 'image' : (file.type.startsWith('video/') ? 'video' : 'audio');

        reader.onload = function(e) {
            attachedMedia = { url: e.target.result, type: fileType };
            const hint = document.getElementById('filePreviewHint');
            hint.textContent = `📎 Прикреплен файл: ${file.name}`;
            hint.style.display = 'block';
        };
        reader.readAsDataURL(file);
    }

    function checkEnter(e) {
        if (e.key === 'Enter') sendMessage();
    }

    async function sendMessage() {
        const input = document.getElementById('msgInput');
        const text = input.value.trim();
        if (!text && !attachedMedia) return;

        await sendMediaMessage(attachedMedia?.url || null, attachedMedia?.type || null, text);
        
        input.value = '';
        attachedMedia = null;
        document.getElementById('filePreviewHint').style.display = 'none';
        document.getElementById('mediaFileInput').value = '';
    }

    async function sendMediaMessage(mediaUrl, mediaType, textStr = '') {
        const mediaObj = mediaUrl ? { url: mediaUrl, type: mediaType } : null;

        if (isGroupChat) {
            const res = await fetch('/api/send-group-message', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ groupId: currentPartner, sender: currentUserLogin, text: textStr, media: mediaObj })
            });
            const data = await res.json();
            if (data.success) { dbData = data.db; renderMessages(); }
            else { showNeonAlert('Ошибка', data.error); }
        } else {
            const res = await fetch('/api/send-message', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sender: currentUserLogin, receiver: currentPartner, text: textStr, media: mediaObj })
            });
            const data = await res.json();
            if (data.success) { dbData = data.db; renderMessages(); }
        }
    }

    // ЛОГИКА ЗВОНКОВ WEBRTC
    async function startCall() {
        if (!currentPartner || isGroupChat) return;
        document.getElementById('callModal').classList.remove('hidden');
        document.getElementById('callStatusText').textContent = 'Вызов пользователя...';

        try {
            localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: isVideoEnabled });
            document.getElementById('localVideo').srcObject = localStream;

            peerConnection = new RTCPeerConnection(rtcConfig);
            localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

            peerConnection.ontrack = (event) => {
                remoteStream = event.streams[0];
                document.getElementById('remoteAudio').srcObject = remoteStream;
                document.getElementById('remoteVideo').srcObject = remoteStream;
            };

            peerConnection.onicecandidate = (event) => {
                if (event.candidate) {
                    socket.emit('ice-candidate', { candidate: event.candidate, to: currentPartner });
                }
            };

            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);

            socket.emit('start-call', { to: currentPartner, from: currentUserLogin, offer });
        } catch (e) {
            showNeonAlert('Ошибка вызова', 'Не удалось инициализировать оборудование для звонка');
            closeCall();
        }
    }

    async function acceptCall(offer) {
        document.getElementById('callModal').classList.remove('hidden');
        document.getElementById('callStatusText').textContent = 'Соединение...';

        try {
            localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: isVideoEnabled });
            document.getElementById('localVideo').srcObject = localStream;

            peerConnection = new RTCPeerConnection(rtcConfig);
            localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

            peerConnection.ontrack = (event) => {
                remoteStream = event.streams[0];
                document.getElementById('remoteAudio').srcObject = remoteStream;
                document.getElementById('remoteVideo').srcObject = remoteStream;
            };

            peerConnection.onicecandidate = (event) => {
                if (event.candidate) {
                    socket.emit('ice-candidate', { candidate: event.candidate, to: currentPartner });
                }
            };

            await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);

            socket.emit('answer-call', { to: currentPartner, answer });
            document.getElementById('callStatusText').textContent = 'В разговоре';
        } catch (e) {
            showNeonAlert('Ошибка', 'Не удалось принять звонок');
            closeCall();
        }
    }

    function toggleVideoCall() {
        isVideoEnabled = !isVideoEnabled;
        if (localStream) {
            const videoTrack = localStream.getVideoTracks()[0];
            if (videoTrack) {
                videoTrack.enabled = isVideoEnabled;
            }
        }
        document.getElementById('remoteVideo').classList.toggle('hidden', !isVideoEnabled);
        document.getElementById('localVideo').classList.toggle('hidden', !isVideoEnabled);
    }

    function endCall() {
        if (currentPartner) {
            socket.emit('hang-up', { to: currentPartner });
        }
        closeCall();
    }

    function closeCall() {
        document.getElementById('callModal').classList.add('hidden');
        if (peerConnection) { peerConnection.close(); peerConnection = null; }
        if (localStream) { localStream.getTracks().forEach(track => track.stop()); localStream = null; }
    }

    // РЕНДЕРИНГ МЕДИАЛЕНТЫ И СООБЩЕСТВ
    function renderContentList() {
        const newsList = document.getElementById('newsList');
        newsList.innerHTML = '';
        memeList.forEach(meme => {
            const div = document.createElement('div');
            div.className = 'meme-card';
            div.innerHTML = `
                <p>${meme.title}</p>
                <video src="${meme.url}" controls></video>
                <div style="font-size:11px; color:#aaa; margin-top:5px;">Источник: ${meme.author}</div>
            `;
            newsList.appendChild(div);
        });
    }

    function renderFeedList() {
        const feedList = document.getElementById('feedList');
        feedList.innerHTML = '';
        const groups = dbData.groups || {};
        let count = 0;

        Object.values(groups).forEach(g => {
            if (g.messages && g.messages.length > 0) {
                g.messages.forEach(m => {
                    count++;
                    const div = document.createElement('div');
                    div.className = 'meme-card';
                    div.style.textAlign = 'left';

                    let mediaHtml = '';
                    if (m.media) {
                        if (m.media.type === 'image') mediaHtml = `<img src="${m.media.url}">`;
                        else if (m.media.type === 'video') mediaHtml = `<video controls src="${m.media.url}"></video>`;
                        else if (m.media.type === 'audio') mediaHtml = `<audio controls src="${m.media.url}"></audio>`;
                    }

                    div.innerHTML = `
                        <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
                            <b style="color:#66fcf1;">🏠 ${g.name}</b>
                            <small style="color:#888;">${m.time}</small>
                        </div>
                        <div>${m.text}</div>
                        ${mediaHtml}
                    `;
                    feedList.appendChild(div);
                });
            }
        });

        if (count === 0) {
            feedList.innerHTML = '<div style="color:#aaa; font-style:italic;">Пока нет публикаций в сообществах</div>';
        }
    }
</script>
</body>
</html>
