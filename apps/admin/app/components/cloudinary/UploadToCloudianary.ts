
const UploadToCloudianary = async (file:File) => {
    const data = new FormData();
        data.append("file", file!);
       
        data.append("upload_preset", "bookmyshow");

        const response = await fetch("https://api.cloudinary.com/v1_1/dwkh9z2rg/image/upload", {
            method: "POST",
            body: data
        })

        
        if (!response.ok) {
            console.log("could not able to uplaod");
        }

        const image = await response.json();
        return image.secure_url;
}

export default UploadToCloudianary