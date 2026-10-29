import mongoose from 'mongoose';

let lastConnectionErrorCode=null;
export async function connectDatabase() {
  const uri=process.env.MONGODB_URI?.trim();
  if(!uri)return false;
  try {
    await mongoose.connect(uri,{serverSelectionTimeoutMS:10000,connectTimeoutMS:10000});
    lastConnectionErrorCode=null;
    console.info('MongoDB connected.');
    return true;
  } catch(error) {
    const topologyError=error.reason?.servers?.values?.().next?.().value?.error;
    lastConnectionErrorCode=error.code||error.cause?.code||topologyError?.code||topologyError?.cause?.code||null;
    console.error('MongoDB connection failed:',JSON.stringify({name:error.name||null,code:lastConnectionErrorCode}));
    return false;
  }
}

export function databaseStatus(){
  return ['disconnected','connected','connecting','disconnecting'][mongoose.connection.readyState]||'unknown';
}

export function databaseErrorCode(){return lastConnectionErrorCode;}
