rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {

    // Existing rules...
    match /profilePictures/{uid}/{allPaths=**} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && request.auth.uid == uid;
    }
    match /chatImages/{userId}/{imageId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null
                   && request.auth.uid == userId
                   && request.resource.size < 10 * 1024 * 1024
                   && request.resource.contentType.matches('image/.*');
    }
    match /audioMessages/{userId}/{allPaths=**} {
      allow read: if request.auth != null;
      allow write: if request.auth != null
                   && request.auth.uid == userId
                   && request.resource.size < 10 * 1024 * 1024
                   && request.resource.contentType.matches('audio/.*');
    }
    match /debug/{uid}/{allPaths=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }

    // New GPX rule: per-user GPX uploads
    match /gpx/{uid}/{allPaths=**} {
      // Any signed-in user may read GPX routes (discoverability)
      allow read: if request.auth != null;

      // Only the user (owner) can write to their folder
      allow write: if request.auth != null
                   && request.auth.uid == uid
                   // limit file size to 10 MB
                   && request.resource.size < 10 * 1024 * 1024
                   // allow GPX/XML mime types (application/gpx+xml, text/xml) or fallback to binary
                   && (
                        request.resource.contentType.matches('application/gpx\\+xml')
                     || request.resource.contentType.matches('text/.*')
                     || request.resource.contentType.matches('application/octet-stream')
                   );
    }

    // keep other existing rules...
  }
}