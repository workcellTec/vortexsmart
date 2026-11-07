// teste-criar-loja.js — script isolado só pra testar a Cloud Function
// criarLoja de fora do app, direto do PC. Usa o SDK client do Firebase,
// que monta a chamada "onCall" corretamente (diferente do functions:shell,
// que não formata isso certo pra callable functions de 2ª geração).

const { initializeApp } = require('firebase/app');
const { getAuth, signInWithEmailAndPassword } = require('firebase/auth');
const { getFunctions, httpsCallable } = require('firebase/functions');

const firebaseConfig = {
    apiKey:            'AIzaSyC1HuGxN7ko4MdYYJCM5QDQmkpbN5lfxA4',
    authDomain:        'vortex-b3761.firebaseapp.com',
    databaseURL:       'https://vortex-b3761-default-rtdb.firebaseio.com',
    projectId:         'vortex-b3761',
    storageBucket:     'vortex-b3761.firebasestorage.app',
    messagingSenderId: '920463151800',
    appId:             '1:920463151800:web:6011489281000edab365a4d'
};

const ADMIN_EMAIL = 'brendon.live2015@gmail.com';
const ADMIN_SENHA = 'Angry1712@';

async function main() {
    const app = initializeApp(firebaseConfig);
    const auth = getAuth(app);
    const functions = getFunctions(app);

    console.log('Fazendo login como admin...');
    await signInWithEmailAndPassword(auth, ADMIN_EMAIL, ADMIN_SENHA);
    console.log('Login OK. Chamando criarLoja...');

    const criarLoja = httpsCallable(functions, 'criarLoja');
    const resultado = await criarLoja({
        nomeLoja: 'Loja Teste',
        emailGestor: 'gestorteste@exemplo.com',
        senhaGestor: 'senha123456',
        nomeGestor: 'Gestor Teste'
    });

    console.log('SUCESSO:', resultado.data);
    process.exit(0);
}

main().catch(e => {
    console.error('ERRO:', e.message);
    process.exit(1);
});