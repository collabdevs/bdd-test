<!doctype html>
<html ng-app="openApp">
  <head>

  <script src="https://ajax.googleapis.com/ajax/libs/angularjs/1.6.4/angular.min.js"></script>
  <script type="text/javascript">
  	
  	var openApp = angular.module('openApp',[]);

	openApp.controller('AppController', ['$scope', '$http', function($scope , $http) {
	    $scope.yourName = 'vem do angular';

	  	var response = $http.get("api")
		  	.then(
		    /* sucesso */
		    function(response) {
		      console.log("response: " + response.data);
		      $scope.dadoApi = response.data;
		      return $scope.dadoApi;
		    },
		    /* falha */
		    function(error) {
		      console.log("The request failed: " + error);
		      $scope.dadoApi = "The request failed: " + error;
		      return $scope.dadoApi;
		  	});
	}]);


  </script>
  <title><?php echo $app_name; ?></title>
  </head>
  <body ng-controller="AppController">
    <div>
      <label>Name:</label>
      <input type="text" ng-model="yourName" placeholder="Enter a name here">
      <hr>
      <h1>Bem vindo {{yourName}}!</h1>
      <h1>resposta da rede : {{dadoApi}}!</h1>
    </div>
  </body>
</html>


